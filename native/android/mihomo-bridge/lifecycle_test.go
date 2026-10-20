package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"syscall"
	"testing"
	"time"
)

type testRawConn struct {
	controls int
	err      error
}

func (r *testRawConn) Control(f func(uintptr)) error {
	r.controls++
	if r.err == nil {
		f(42)
	}
	return r.err
}
func (r *testRawConn) Read(func(uintptr) bool) error  { return nil }
func (r *testRawConn) Write(func(uintptr) bool) error { return nil }

var _ syscall.RawConn = (*testRawConn)(nil)

type testListener struct {
	closes  int
	err     error
	onClose func()
}

func (l *testListener) Close() error {
	l.closes++
	if l.onClose != nil {
		l.onClose()
	}
	return l.err
}

type lifecycleCloser struct {
	closes int
	err    error
}

func (c *lifecycleCloser) Close() error {
	c.closes++
	return c.err
}

func TestSocketGate(t *testing.T) {
	for _, tc := range []struct {
		name           string
		ready, protect bool
		controlErr     error
		wantErr        bool
	}{
		{"default blocked", false, true, nil, true},
		{"protected", true, true, nil, false},
		{"protector refusal", true, false, nil, true},
		{"raw connection error", true, true, errors.New("control failed"), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var lifecycle androidTunLifecycle
			lifecycle.protected.Store(tc.ready)
			conn := &testRawConn{err: tc.controlErr}
			calls := 0
			err := lifecycle.socketHook(conn, func(fd int) bool {
				calls++
				if fd != 42 {
					t.Fatalf("unexpected fd %d", fd)
				}
				return tc.protect
			})
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v", err)
			}
			if !tc.ready && (calls != 0 || conn.controls != 0) {
				t.Fatal("blocked state touched socket")
			}
			if tc.controlErr != nil && !errors.Is(err, tc.controlErr) {
				t.Fatal("lost control error")
			}
		})
	}
}

func TestCloseRetainsFailedListenerAndBlocksBeforeClosing(t *testing.T) {
	var lifecycle androidTunLifecycle
	failure := errors.New("close failed")
	listener := &testListener{err: failure}
	listener.onClose = func() {
		if lifecycle.protected.Load() {
			t.Fatal("dial gate was open during close")
		}
	}
	lifecycle.listener = listener
	lifecycle.protected.Store(true)
	if !errors.Is(lifecycle.closeTun(), failure) {
		t.Fatal("close error was swallowed")
	}
	if lifecycle.listener != listener {
		t.Fatal("failed listener ownership was lost")
	}
	lifecycle.applyConfiguration(func() {})
	if lifecycle.protected.Load() {
		t.Fatal("config reopened a failed-stop listener")
	}
	listener.err = nil
	if err := lifecycle.closeTun(); err != nil {
		t.Fatal(err)
	}
	if lifecycle.listener != nil || lifecycle.protected.Load() || listener.closes != 2 {
		t.Fatal("retry did not finish cleanup")
	}
	if err := lifecycle.closeTun(); err != nil || listener.closes != 2 {
		t.Fatal("stop was not idempotent")
	}
}

func TestConfigurationBlocksTemporarilyWithoutInventingReadiness(t *testing.T) {
	for _, ready := range []bool{false, true} {
		var lifecycle androidTunLifecycle
		lifecycle.protected.Store(ready)
		lifecycle.applyConfiguration(func() {
			if lifecycle.protected.Load() {
				t.Fatal("dial gate was open during config application")
			}
		})
		if lifecycle.protected.Load() != ready {
			t.Fatal("configuration changed readiness")
		}
	}
}

func TestConfigurationPanicLeavesGateBlocked(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected panic")
			}
		}()
		lifecycle.applyConfiguration(func() { panic("apply failed") })
	}()
	if lifecycle.protected.Load() {
		t.Fatal("panic restored dial admission")
	}
}

func TestTransitionsDrainInFlightProtection(t *testing.T) {
	for _, operation := range []string{"stop", "configuration"} {
		t.Run(operation, func(t *testing.T) {
			var lifecycle androidTunLifecycle
			lifecycle.protected.Store(true)
			entered := make(chan struct{})
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			hookDone := make(chan error, 1)
			go func() {
				hookDone <- lifecycle.socketHook(&testRawConn{}, func(int) bool {
					close(entered)
					<-release
					return true
				})
			}()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("protect did not enter")
			}
			transition := make(chan struct{}, 1)
			done := make(chan error, 1)
			// Calling socketHook from Close/apply must reject without deadlocking:
			// the writer lock must not span arbitrary upstream cleanup/config code.
			onTransition := func() {
				transition <- struct{}{}
				if err := lifecycle.socketHook(&testRawConn{}, func(int) bool {
					t.Error("transition admitted a new protect callback")
					return true
				}); err == nil {
					t.Error("transition admitted a socket")
				}
			}
			lifecycle.listener = &testListener{onClose: onTransition}
			go func() {
				if operation == "stop" {
					done <- lifecycle.closeTun()
				} else {
					lifecycle.applyConfiguration(onTransition)
					done <- nil
				}
			}()
			deadline := time.Now().Add(5 * time.Second)
			for lifecycle.protected.Load() {
				if time.Now().After(deadline) {
					t.Fatal("transition did not close admission")
				}
				time.Sleep(time.Millisecond)
			}
			select {
			case <-transition:
				t.Fatal("transition ran before the protect callback drained")
			default:
			}
			if err := lifecycle.socketHook(&testRawConn{}, func(int) bool {
				t.Error("blocked gate called protect")
				return true
			}); err == nil {
				t.Fatal("closed admission allowed a new socket")
			}
			unblock()
			select {
			case err := <-hookDone:
				if err == nil {
					t.Fatal("in-flight hook reported stale successful admission")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("protect callback did not exit")
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("transition deadlocked")
			}
			if lifecycle.protected.Load() != (operation == "configuration") {
				t.Fatal("transition restored incorrect admission state")
			}
		})
	}
}

func TestProtectionPanicReleasesAdmissionBarrier(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	func() {
		defer func() {
			if recover() == nil {
				t.Error("expected protect panic")
			}
		}()
		_ = lifecycle.socketHook(&testRawConn{}, func(int) bool { panic("protect failed") })
	}()
	done := make(chan error, 1)
	go func() { done <- lifecycle.closeTun() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("panic leaked the admission read lock")
	}
}

func TestCloseConnectionsJoinsErrorsAndContinues(t *testing.T) {
	var lifecycle androidTunLifecycle
	firstErr := errors.New("first connection close failed")
	lastErr := errors.New("last connection close failed")
	first := &lifecycleCloser{err: firstErr}
	middle := &lifecycleCloser{}
	last := &lifecycleCloser{err: lastErr}

	err := lifecycle.closeConnections(map[string]io.Closer{
		"first":  first,
		"middle": middle,
		"last":   last,
	})
	if !errors.Is(err, firstErr) || !errors.Is(err, lastErr) {
		t.Fatalf("close error = %v, want both causes", err)
	}
	if first.closes != 1 || middle.closes != 1 || last.closes != 1 {
		t.Fatalf("close counts = %d, %d, %d; want each closer called once", first.closes, middle.closes, last.closes)
	}
	if lifecycle.pendingConnections["first"] != first || lifecycle.pendingConnections["last"] != last {
		t.Fatal("failed closers were not retained for retry")
	}
	if _, ok := lifecycle.pendingConnections["middle"]; ok {
		t.Fatal("successful closer was retained")
	}
}

func TestCloseConnectionsRetriesFailedOwnership(t *testing.T) {
	var lifecycle androidTunLifecycle
	failure := errors.New("retryable close failure")
	closer := &lifecycleCloser{err: failure}

	if err := lifecycle.closeConnections(map[string]io.Closer{"conn": closer}); !errors.Is(err, failure) {
		t.Fatalf("initial close error = %v", err)
	}
	closer.err = nil
	if err := lifecycle.closeConnections(nil); err != nil {
		t.Fatalf("retry error = %v", err)
	}
	if closer.closes != 2 {
		t.Fatalf("close count = %d, want 2", closer.closes)
	}
	if len(lifecycle.pendingConnections) != 0 {
		t.Fatalf("pending connections = %v, want empty", lifecycle.pendingConnections)
	}
	if err := lifecycle.closeConnections(map[string]io.Closer{}); err != nil {
		t.Fatalf("empty idempotent close error = %v", err)
	}
	if closer.closes != 2 {
		t.Fatalf("successful closer was closed again: count %d", closer.closes)
	}
}

func TestCloseConnectionsDoesNotRepeatSuccessfulCloser(t *testing.T) {
	var lifecycle androidTunLifecycle
	closer := &lifecycleCloser{}

	if err := lifecycle.closeConnections(map[string]io.Closer{"conn": closer}); err != nil {
		t.Fatal(err)
	}
	if err := lifecycle.closeConnections(nil); err != nil {
		t.Fatal(err)
	}
	if closer.closes != 1 {
		t.Fatalf("close count = %d, want 1", closer.closes)
	}
}

func TestCloseConnectionsPreservesFailedPendingOwnerOnDuplicateID(t *testing.T) {
	var lifecycle androidTunLifecycle
	failure := errors.New("owner close failure")
	owner := &lifecycleCloser{err: failure}
	replacement := &lifecycleCloser{}
	lifecycle.pendingConnections = map[string]io.Closer{"same": owner}

	if err := lifecycle.closeConnections(map[string]io.Closer{"same": replacement}); !errors.Is(err, failure) {
		t.Fatalf("duplicate close error = %v", err)
	}
	if owner.closes != 1 {
		t.Fatalf("pending owner close count = %d, want 1", owner.closes)
	}
	if replacement.closes != 0 {
		t.Fatalf("replacement was closed %d times, want 0", replacement.closes)
	}
	if lifecycle.pendingConnections["same"] != owner {
		t.Fatal("duplicate snapshot replaced failed pending owner")
	}

	owner.err = nil
	if err := lifecycle.closeConnections(nil); err != nil {
		t.Fatal(err)
	}
	if owner.closes != 2 || len(lifecycle.pendingConnections) != 0 {
		t.Fatalf("owner was not removed after successful retry: closes=%d pending=%v", owner.closes, lifecycle.pendingConnections)
	}
}

func TestCloseConnectionsAcceptsOnlyAlreadyClosedErrors(t *testing.T) {
	failure := errors.New("another cleanup failure")
	for _, tc := range []struct {
		name        string
		err         error
		wantPending bool
	}{
		{"closed", net.ErrClosed, false},
		{"wrapped closed", fmt.Errorf("close: %w", net.ErrClosed), false},
		{"joined closed", errors.Join(net.ErrClosed, fmt.Errorf("close: %w", net.ErrClosed)), false},
		{"mixed failure", errors.Join(net.ErrClosed, failure), true},
		{"wrapped mixed failure", fmt.Errorf("close: %w", errors.Join(net.ErrClosed, failure)), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var lifecycle androidTunLifecycle
			closer := &lifecycleCloser{err: tc.err}
			err := lifecycle.closeConnections(map[string]io.Closer{"conn": closer})
			if (err != nil) != tc.wantPending || (len(lifecycle.pendingConnections) != 0) != tc.wantPending {
				t.Fatalf("unexpected cleanup result: err=%v pending=%v", err, lifecycle.pendingConnections)
			}
			if tc.wantPending && !errors.Is(err, failure) {
				t.Fatal("mixed error lost its real failure")
			}
			if !tc.wantPending {
				if err := lifecycle.closeConnections(nil); err != nil || closer.closes != 1 {
					t.Fatal("already-closed cleanup was not idempotent")
				}
			}
		})
	}
}
