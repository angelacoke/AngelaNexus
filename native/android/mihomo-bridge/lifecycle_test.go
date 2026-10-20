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
	for _, operation := range []string{"stop", "configuration", "stop announcement"} {
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
				} else if operation == "stop announcement" {
					lifecycle.beginStop()
					onTransition()
					lifecycle.endStop()
					done <- nil
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

// Model a hook paused immediately after sampling its entry token. A transition
// can finish and reopen readiness before that hook obtains the admission lock.
// A boolean alone would admit it into a different runtime/configuration epoch.
func TestSocketGateRejectsStaleEpochAfterReopen(t *testing.T) {
	for _, transition := range []string{"configuration", "stop and restart", "repeated stop"} {
		t.Run(transition, func(t *testing.T) {
			var lifecycle androidTunLifecycle
			lifecycle.protected.Store(true)
			stale := lifecycle.epoch.Load()
			switch transition {
			case "configuration":
				lifecycle.applyConfiguration(func() {})
			case "stop and restart", "repeated stop":
				if err := lifecycle.closeTun(); err != nil {
					t.Fatal(err)
				}
				if transition == "repeated stop" {
					if err := lifecycle.closeTun(); err != nil {
						t.Fatal(err)
					}
				}
				// Simulate successful new listener construction, not Android TUN.
				lifecycle.protected.Store(true)
			}
			if lifecycle.epoch.Load() == stale {
				t.Fatal("transition did not invalidate the entry token")
			}
			conn := &testRawConn{}
			protects := 0
			protect := func(int) bool { protects++; return true }
			if err := lifecycle.socketHookAtEpoch(stale, conn, protect); err == nil {
				t.Fatal("stale hook borrowed reopened readiness")
			}
			if conn.controls != 0 || protects != 0 {
				t.Fatal("stale hook touched the socket or called protect")
			}
			if err := lifecycle.socketHook(conn, protect); err != nil {
				t.Fatalf("fresh hook was blocked: %v", err)
			}
			if conn.controls != 1 || protects != 1 {
				t.Fatal("fresh hook did not protect exactly once")
			}
		})
	}
}

func TestCloseTunAcceptsOnlyAlreadyClosedErrors(t *testing.T) {
	failure := errors.New("another listener cleanup failure")
	for _, tc := range []struct {
		name        string
		err         error
		wantPending bool
	}{
		{"closed", net.ErrClosed, false},
		{"wrapped closed", fmt.Errorf("listener: %w", net.ErrClosed), false},
		{"joined closed", errors.Join(net.ErrClosed, fmt.Errorf("listener: %w", net.ErrClosed)), false},
		{"mixed failure", errors.Join(net.ErrClosed, failure), true},
		{"wrapped mixed failure", fmt.Errorf("listener: %w", errors.Join(net.ErrClosed, failure)), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var lifecycle androidTunLifecycle
			listener := &testListener{err: tc.err}
			lifecycle.listener = listener
			lifecycle.protected.Store(true)
			err := lifecycle.closeTun()
			if (err != nil) != tc.wantPending || (lifecycle.listener != nil) != tc.wantPending {
				t.Fatalf("unexpected cleanup result: err=%v listener=%v", err, lifecycle.listener)
			}
			if lifecycle.protected.Load() {
				t.Fatal("listener cleanup reopened admission")
			}
			if tc.wantPending {
				if !errors.Is(err, failure) || lifecycle.listener != listener {
					t.Fatal("mixed failure lost cause or ownership")
				}
				listener.err = net.ErrClosed
			}
			if err := lifecycle.closeTun(); err != nil || lifecycle.listener != nil {
				t.Fatalf("repeat cleanup failed: %v", err)
			}
			wantCloses := 1
			if tc.wantPending {
				wantCloses = 2
			}
			if listener.closes != wantCloses {
				t.Fatalf("close count = %d, want %d", listener.closes, wantCloses)
			}
		})
	}
}

func TestPendingStopsCannotBorrowReopenedReadiness(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	lifecycle.beginStop()
	lifecycle.beginStop()
	if lifecycle.pendingStops.Load() != 2 {
		t.Fatal("concurrent stop requests were not counted")
	}
	// Model a constructor which passed its initial check before stop was queued.
	lifecycle.protected.Store(true)
	assertBlocked := func() {
		t.Helper()
		conn := &testRawConn{}
		if lifecycle.ready() {
			t.Fatal("pending stop borrowed reopened readiness")
		}
		if err := lifecycle.socketHook(conn, func(int) bool {
			t.Error("pending stop invoked protection")
			return true
		}); err == nil || conn.controls != 0 {
			t.Fatal("pending stop admitted or touched a socket")
		}
	}
	assertBlocked()
	lifecycle.endStop()
	assertBlocked()
	if err := lifecycle.closeTun(); err != nil {
		t.Fatal(err)
	}
	lifecycle.endStop()
	if lifecycle.pendingStops.Load() != 0 || lifecycle.ready() {
		t.Fatal("completed stops left a request or invented readiness")
	}
	// A genuinely new ready runtime is usable after all stop calls complete.
	lifecycle.protected.Store(true)
	if err := lifecycle.socketHook(&testRawConn{}, func(int) bool { return true }); err != nil {
		t.Fatalf("fresh runtime stayed blocked: %v", err)
	}
}

func TestStopDuringConfigurationPreventsReadinessRestore(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	lifecycle.applyConfiguration(func() {
		lifecycle.beginStop()
	})
	if lifecycle.protected.Load() || lifecycle.ready() {
		t.Fatal("configuration restored admission over a pending stop")
	}
	lifecycle.endStop()
	if lifecycle.ready() {
		t.Fatal("completing stop restored stale readiness")
	}
}

func TestStopBarrierCannotBeUndoneByConcurrentRestore(t *testing.T) {
	for iteration := 0; iteration < 500; iteration++ {
		var lifecycle androidTunLifecycle
		lifecycle.protected.Store(true)
		start := make(chan struct{})
		restored := make(chan struct{})
		go func() {
			<-start
			lifecycle.restoreAdmission(true)
			close(restored)
		}()
		close(start)
		lifecycle.beginStop()
		<-restored
		if lifecycle.protected.Load() || lifecycle.ready() {
			t.Fatalf("iteration %d: late restoration undid stop barrier", iteration)
		}
		lifecycle.endStop()
	}
}

func TestStopDrainReassertsClosureAfterAlreadyEnteredRestore(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	// Model restoreAdmission holding the writer lock after it sampled no stop,
	// but before publishing readiness. Stop can announce and close the gate,
	// then must wait for this writer before completing its callback drain.
	lifecycle.admission.Lock()
	locked := true
	done := make(chan struct{})
	go func() {
		lifecycle.beginStop()
		close(done)
	}()
	defer func() {
		if locked {
			lifecycle.admission.Unlock()
		}
		<-done
		lifecycle.endStop()
	}()
	deadline := time.Now().Add(5 * time.Second)
	for lifecycle.pendingStops.Load() != 1 || lifecycle.protected.Load() {
		if time.Now().After(deadline) {
			t.Fatal("stop did not close the gate before waiting for the writer")
		}
		time.Sleep(time.Millisecond)
	}
	lifecycle.protected.Store(true) // The already-entered writer's late publication.
	lifecycle.admission.Unlock()
	locked = false
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("stop did not finish draining the old readiness writer")
	}
	if lifecycle.protected.Load() || lifecycle.ready() {
		t.Fatal("stop drain did not reassert closure after late readiness publication")
	}
}

func TestExplicitSuspendPreservesOwnershipAndInvalidatesEpoch(t *testing.T) {
	for _, protected := range []bool{false, true} {
		var lifecycle androidTunLifecycle
		lifecycle.protected.Store(protected)
		oldEpoch := lifecycle.epoch.Load()
		lifecycle.setSuspended(true)
		lifecycle.setSuspended(true) // Idempotent pause must never resume.
		if lifecycle.ready() || lifecycle.protected.Load() != protected {
			t.Fatal("pause lost protection ownership or left admission open")
		}
		conn := &testRawConn{}
		protect := func(int) bool { return true }
		if err := lifecycle.socketHook(conn, protect); err == nil || conn.controls != 0 {
			t.Fatal("pause admitted a new callback")
		}
		lifecycle.applyConfiguration(func() {})
		if lifecycle.ready() || !lifecycle.suspended.Load() {
			t.Fatal("configuration cleared explicit pause")
		}
		lifecycle.setSuspended(false)
		if lifecycle.ready() != protected {
			t.Fatal("resume invented or lost readiness")
		}
		if err := lifecycle.socketHookAtEpoch(oldEpoch, conn, protect); err == nil || conn.controls != 0 {
			t.Fatal("stale pre-pause hook borrowed resumed readiness")
		}
		if err := lifecycle.socketHook(conn, protect); (err == nil) != protected {
			t.Fatalf("fresh hook after resume: protected=%t err=%v", protected, err)
		}
		lifecycle.beginStop()
		lifecycle.setSuspended(false)
		lifecycle.restoreAdmission(true)
		if lifecycle.ready() {
			t.Fatal("resume overrode pending stop")
		}
		lifecycle.endStop()
		if lifecycle.ready() {
			t.Fatal("resume reopened completed stop")
		}
	}
}

func TestExplicitSuspendDrainsInFlightProtection(t *testing.T) {
	for _, queued := range []bool{false, true} {
		t.Run(fmt.Sprintf("queued=%t", queued), func(t *testing.T) {
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
			paused := make(chan struct{})
			go func() {
				if queued {
					lifecycle.beginSuspend()
				} else {
					lifecycle.setSuspended(true)
				}
				close(paused)
			}()
			deadline := time.Now().Add(5 * time.Second)
			for !lifecycle.suspended.Load() {
				if time.Now().After(deadline) {
					t.Fatal("pause did not close admission")
				}
				time.Sleep(time.Millisecond)
			}
			select {
			case <-paused:
				t.Fatal("pause returned before in-flight protect drained")
			default:
			}
			if err := lifecycle.socketHook(&testRawConn{}, func(int) bool {
				t.Error("paused gate invoked protect")
				return true
			}); err == nil {
				t.Fatal("pause admitted another socket")
			}
			unblock()
			select {
			case err := <-hookDone:
				if err == nil {
					t.Fatal("in-flight callback reported stale successful admission")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("protect did not exit")
			}
			select {
			case <-paused:
			case <-time.After(5 * time.Second):
				t.Fatal("pause barrier deadlocked")
			}
			if queued {
				lifecycle.setSuspended(true)
				lifecycle.endSuspend()
			}
			lifecycle.setSuspended(false)
			if !lifecycle.ready() {
				t.Fatal("resume lost attached runtime readiness")
			}
		})
	}
}

func TestExplicitSuspendInvalidatesEpochWithoutConfiguration(t *testing.T) {
	var lifecycle androidTunLifecycle
	lifecycle.protected.Store(true)
	oldEpoch := lifecycle.epoch.Load()
	lifecycle.setSuspended(true)
	lifecycle.setSuspended(false)
	conn := &testRawConn{}
	if err := lifecycle.socketHookAtEpoch(oldEpoch, conn, func(int) bool { return true }); err == nil || conn.controls != 0 {
		t.Fatal("pre-pause hook borrowed readiness after resume")
	}
	if err := lifecycle.socketHook(conn, func(int) bool { return true }); err != nil || conn.controls != 1 {
		t.Fatalf("fresh post-resume hook failed: %v", err)
	}
}

func TestPendingSuspendCannotBeBypassed(t *testing.T) {
	for _, requests := range []int{1, 2} {
		t.Run(fmt.Sprintf("requests=%d", requests), func(t *testing.T) {
			var lifecycle androidTunLifecycle
			lifecycle.protected.Store(true)
			oldEpoch := lifecycle.epoch.Load()
			for i := 0; i < requests; i++ {
				lifecycle.beginSuspend()
			}
			for i := 0; i < requests; i++ {
				// Model resume/start already holding the control mutex.
				lifecycle.setSuspended(false)
				lifecycle.restoreAdmission(true)
				conn := &testRawConn{}
				if err := lifecycle.socketHook(conn, func(int) bool {
					t.Error("pending pause reached protector")
					return true
				}); err == nil || conn.controls != 0 {
					t.Fatal("pending pause admitted a socket")
				}
				// Queued pause gets the control mutex and reasserts its state.
				lifecycle.setSuspended(true)
				lifecycle.endSuspend()
				if lifecycle.ready() || !lifecycle.protected.Load() {
					t.Fatal("pause reopened admission or lost protection ownership")
				}
			}
			if lifecycle.pendingSuspends.Load() != 0 {
				t.Fatal("pause request count leaked")
			}
			lifecycle.setSuspended(false)
			if !lifecycle.ready() {
				t.Fatal("completed pause could not be explicitly resumed")
			}
			if err := lifecycle.socketHookAtEpoch(oldEpoch, &testRawConn{}, func(int) bool {
				t.Error("stale entry reached protector")
				return true
			}); err == nil {
				t.Fatal("pending pause did not invalidate old hook entry")
			}
		})
	}
}
