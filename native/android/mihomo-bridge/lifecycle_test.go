package main

import (
	"errors"
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
