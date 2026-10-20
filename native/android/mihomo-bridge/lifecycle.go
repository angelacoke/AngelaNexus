package main

import (
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"syscall"
)

// Callers serialize listener/configuration changes with androidTunMu. The socket
// hook runs concurrently. admission drains callbacks that already entered the
// hook before configuration/stop proceeds. This is not a dial-completion barrier:
// a connect can still finish after its hook returned, and existing connections
// and upstream background tasks are not closed here.
type androidTunLifecycle struct {
	listener  io.Closer
	protected atomic.Bool
	admission sync.RWMutex
}

func (l *androidTunLifecycle) socketHook(conn syscall.RawConn, protect func(int) bool) error {
	if !l.protected.Load() {
		return errors.New("Android VpnService protection is not ready; dialing is blocked")
	}
	l.admission.RLock()
	defer l.admission.RUnlock()
	if !l.protected.Load() {
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
	if !l.protected.Load() {
		return errors.New("Android socket admission closed during protection")
	}
	return nil
}

func (l *androidTunLifecycle) blockAndDrain() bool {
	// Block new callbacks before waiting for existing callbacks. Do not hold the
	// write lock across listener.Close or executor.ApplyConfig: they can invoke
	// the socket hook themselves, and must observe rejection, not deadlock.
	wasProtected := l.protected.Swap(false)
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
		if err := l.listener.Close(); err != nil {
			return err
		}
		l.listener = nil
	}
	return nil
}
