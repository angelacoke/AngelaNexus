package main

import (
	"errors"
	"io"
	"sync/atomic"
	"syscall"
)

// Callers serialize listener/configuration changes with androidTunMu. The socket
// hook runs concurrently, so its admission state must remain atomic. This gate
// does not close existing connections or terminate the upstream core.
type androidTunLifecycle struct {
	listener  io.Closer
	protected atomic.Bool
}

func (l *androidTunLifecycle) socketHook(conn syscall.RawConn, protect func(int) bool) error {
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
	return protectErr
}

func (l *androidTunLifecycle) applyConfiguration(apply func()) {
	// A retained listener after a failed close is not evidence of readiness.
	// Only restore a previously admitted state, never infer it from non-nil.
	wasProtected := l.protected.Swap(false)
	apply()
	l.protected.Store(wasProtected)
}

func (l *androidTunLifecycle) closeTun() error {
	l.protected.Store(false)
	if l.listener != nil {
		if err := l.listener.Close(); err != nil {
			return err
		}
		l.listener = nil
	}
	return nil
}
