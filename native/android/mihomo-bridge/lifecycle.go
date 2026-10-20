package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"syscall"
)

// Callers serialize listener/configuration changes with androidTunMu. The socket
// hook runs concurrently. admission drains callbacks that already entered the
// hook before configuration/stop proceeds. This is not a dial-completion barrier:
// a connect can still finish after its hook returned, and existing connections
// are closed only if captured by the caller's tracker snapshot. Upstream
// background tasks are not stopped here.
type androidTunLifecycle struct {
	listener  io.Closer
	protected atomic.Bool
	// Explicit pause is independent of listener/protection ownership. Applying
	// configuration must not clear it or invent readiness when resuming.
	suspended atomic.Bool
	// Stop announces itself before waiting for the control mutex. Count requests
	// so one completed stop cannot reopen admission while another is queued.
	pendingStops atomic.Int64
	// A pause also announces itself before waiting for parsing/configuration.
	// A concurrent resume/start cannot bypass pauses still waiting for that lock.
	pendingSuspends atomic.Int64
	admission       sync.RWMutex
	// Invalidates callbacks which sampled admission before a transition but did
	// not acquire the read lock until after a later configuration/start reopened it.
	epoch atomic.Uint64
	// Serialized by androidTunMu, not admission. Upstream trackers unregister
	// before their underlying Close returns, even on failure; retain ownership.
	pendingConnections map[string]io.Closer
}

func (l *androidTunLifecycle) socketHook(conn syscall.RawConn, protect func(int) bool) error {
	return l.socketHookAtEpoch(l.epoch.Load(), conn, protect)
}

// Capture the epoch at hook entry, before any readiness check or lock wait.
// Keeping the captured token explicit also permits deterministic stale-entry
// regression tests without relying on goroutine scheduling or sleeps.
func (l *androidTunLifecycle) socketHookAtEpoch(epoch uint64, conn syscall.RawConn, protect func(int) bool) error {
	if !l.ready() {
		return errors.New("Android VpnService protection is not ready; dialing is blocked")
	}
	l.admission.RLock()
	defer l.admission.RUnlock()
	if !l.ready() || epoch != l.epoch.Load() {
		return errors.New("Android VpnService protection is not ready; dialing is blocked")
	}
	var protectErr error
	if err := conn.Control(func(fd uintptr) {
		if !protect(int(fd)) {
			protectErr = errors.New("Android VpnService.protect refused the core socket")
		}
	}); err != nil {
		return err
	}
	if protectErr != nil {
		return protectErr
	}
	// A stop/configuration may have closed admission while protect was running.
	// Reject that socket rather than report a stale successful admission.
	if !l.ready() || epoch != l.epoch.Load() {
		return errors.New("Android socket admission closed during protection")
	}
	return nil
}

func (l *androidTunLifecycle) ready() bool {
	return l.protected.Load() && !l.suspended.Load() && l.pendingStops.Load() == 0 && l.pendingSuspends.Load() == 0
}

// Gate and drain before waiting for the control mutex. The caller must assert
// the final paused state again under that mutex before endSuspend: a resume
// already holding it may clear suspended, but cannot bypass pendingSuspends.
// This barrier does not cancel a parser or wait for a completed socket's dial.
func (l *androidTunLifecycle) beginSuspend() {
	l.pendingSuspends.Add(1)
	l.setSuspended(true)
}

func (l *androidTunLifecycle) endSuspend() {
	l.pendingSuspends.Add(-1)
}

// Final pause/resume and start state is serialized with androidTunMu; an early
// pause announcement can concurrently set the flag, guarded by pendingSuspends.
// Pause drains callbacks and invalidates stale entries; resume changes only the
// pause flag, never protection/cleanup ownership.
// Stop may concurrently announce itself and is still authoritative in ready().
func (l *androidTunLifecycle) setSuspended(suspended bool) {
	if suspended {
		l.suspended.Store(true)
		l.epoch.Add(1)
		l.admission.Lock()
		l.admission.Unlock()
		return
	}
	l.admission.Lock()
	l.suspended.Store(false)
	l.admission.Unlock()
}

// beginStop does not need the control mutex: callers must announce the stop
// before waiting for a parser/apply holding it. Only atomic admission state and
// the callback barrier are touched here, never listener/connection ownership.
// A hook already inside its read-side critical section is drained before this
// returns. A hook which completed earlier is still outside this contract.
func (l *androidTunLifecycle) beginStop() {
	l.pendingStops.Add(1)
	l.blockAndDrain()
}

func (l *androidTunLifecycle) endStop() {
	l.pendingStops.Add(-1)
}

// Serialize restoration with the callback drain. Without this write lock, a
// restore which sampled pendingStops==0 could pause, let beginStop finish, then
// publish stale readiness after the stop's barrier returned.
func (l *androidTunLifecycle) restoreAdmission(wasProtected bool) {
	l.admission.Lock()
	defer l.admission.Unlock()
	l.protected.Store(wasProtected && l.pendingStops.Load() == 0)
}

func (l *androidTunLifecycle) blockAndDrain() bool {
	// Block new callbacks before waiting for existing callbacks. Do not hold the
	// write lock across listener.Close or executor.ApplyConfig: they can invoke
	// the socket hook themselves, and must observe rejection, not deadlock.
	wasProtected := l.protected.Swap(false)
	l.epoch.Add(1)
	l.admission.Lock()
	// An already-entered restore may publish true after the initial Swap using
	// a pending-stop value sampled earlier. Reassert closure under its lock.
	l.protected.Store(false)
	l.admission.Unlock()
	return wasProtected
}

func (l *androidTunLifecycle) applyConfiguration(apply func()) {
	// A retained listener after a failed close is not evidence of readiness.
	// Only restore a previously admitted state, never infer it from non-nil.
	wasProtected := l.blockAndDrain()
	apply()
	l.restoreAdmission(wasProtected)
}

func (l *androidTunLifecycle) closeTun() error {
	l.blockAndDrain()
	if l.listener != nil {
		if err := l.listener.Close(); err != nil && !onlyClosedConnectionError(err) {
			return err
		}
		l.listener = nil
	}
	return nil
}

// closeConnections attempts every captured connection, even if another close
// fails. The caller must serialize this with listener/configuration transitions
// and close socket admission first. This is a snapshot, not a barrier against
// late tracker registration or proof of complete core shutdown.
func (l *androidTunLifecycle) closeConnections(connections map[string]io.Closer) error {
	if l.pendingConnections == nil {
		l.pendingConnections = make(map[string]io.Closer)
	}
	for id, connection := range connections {
		if _, pending := l.pendingConnections[id]; !pending {
			l.pendingConnections[id] = connection
		}
	}
	var failures []error
	for id, connection := range l.pendingConnections {
		if err := connection.Close(); err != nil && !onlyClosedConnectionError(err) {
			failures = append(failures, fmt.Errorf("close tracked connection %s: %w", id, err))
			continue
		}
		delete(l.pendingConnections, id)
	}
	return errors.Join(failures...)
}

// A worker may close a captured socket before our Close runs. The standard
// net.ErrClosed (possibly wrapped) means ownership is already released. Do not
// discard a joined error that also contains an unrelated cleanup failure.
func onlyClosedConnectionError(err error) bool {
	if err == net.ErrClosed {
		return true
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		causes := joined.Unwrap()
		if len(causes) == 0 {
			return false
		}
		for _, cause := range causes {
			if !onlyClosedConnectionError(cause) {
				return false
			}
		}
		return true
	}
	if wrapped, ok := err.(interface{ Unwrap() error }); ok {
		return onlyClosedConnectionError(wrapped.Unwrap())
	}
	return false
}
