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
	admission sync.RWMutex
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
	if !l.protected.Load() {
		return errors.New("Android VpnService protection is not ready; dialing is blocked")
	}
	l.admission.RLock()
	defer l.admission.RUnlock()
	if !l.protected.Load() || epoch != l.epoch.Load() {
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
	if !l.protected.Load() || epoch != l.epoch.Load() {
		return errors.New("Android socket admission closed during protection")
	}
	return nil
}

func (l *androidTunLifecycle) blockAndDrain() bool {
	// Block new callbacks before waiting for existing callbacks. Do not hold the
	// write lock across listener.Close or executor.ApplyConfig: they can invoke
	// the socket hook themselves, and must observe rejection, not deadlock.
	wasProtected := l.protected.Swap(false)
	l.epoch.Add(1)
	l.admission.Lock()
	l.admission.Unlock()
	return wasProtected
}

func (l *androidTunLifecycle) applyConfiguration(apply func()) {
	// A retained listener after a failed close is not evidence of readiness.
	// Only restore a previously admitted state, never infer it from non-nil.
	wasProtected := l.blockAndDrain()
	apply()
	l.protected.Store(wasProtected)
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
