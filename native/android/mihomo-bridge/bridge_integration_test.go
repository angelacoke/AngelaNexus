package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter/outbound"
	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/hub/executor"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/listener/sing_tun"
	"github.com/metacubex/mihomo/tunnel"
	"github.com/metacubex/mihomo/tunnel/statistic"
	"golang.org/x/sys/unix"
)

func bridgeConfigJSON(mode string) []byte {
	return []byte(fmt.Sprintf(`{"mode":%q,"log-level":"silent","geo-auto-update":false,"rules":["MATCH,DIRECT"],"dns":{"enable":false},"tun":{"enable":false},"ntp":{"enable":false}}`, mode))
}

// These calls use the same non-cgo bodies as the exported entry points. In the
// pinned upstream Parse temporarily mutates globals; racing Parse against Apply
// can undo the applied state even though Apply itself holds the lifecycle lock.
func TestAndroidBridgeConcurrentConfigurationAndDNS(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	home := t.TempDir()
	if err := initializeAndroid(home); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	})
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var workers sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			<-start
			for iteration := 0; iteration < 4; iteration++ {
				var err error
				switch worker {
				case 0, 1:
					err = applyAndroidConfigJSON(bridgeConfigJSON([]string{"direct", "rule"}[worker]))
				case 2:
					err = updateAndroidDNS("127.0.0.1")
				case 3:
					err = initializeAndroid(home)
					if err == nil {
						err = stopTunError()
					}
				}
				if err != nil && !errors.Is(err, errAndroidConfigurationStopped) {
					t.Errorf("worker %d iteration %d: %v", worker, iteration, err)
					return
				}
			}
		}(worker)
	}
	close(start)
	workers.Wait()
	var saved struct {
		Mode string `json:"mode"`
	}
	if err := json.Unmarshal(lastConfigJSON, &saved); err != nil {
		t.Fatal(err)
	}
	if actual := executor.GetGeneral().Mode.String(); !strings.EqualFold(actual, saved.Mode) {
		t.Fatalf("saved mode %q differs from upstream mode %q after concurrent operations", saved.Mode, actual)
	}
	if androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("concurrent configuration reopened an unattached runtime")
	}
}

func TestAndroidBridgeRejectedConfigurationPreservesSavedState(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = stopTunError() })
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
		t.Fatal(err)
	}
	saved := append([]byte(nil), lastConfigJSON...)
	for _, invalid := range [][]byte{nil, []byte(`{"mode":"not-a-mode"}`), []byte(`{"proxies":[{"name":"bad","type":"not-a-protocol"}]}`)} {
		if err := applyAndroidConfigJSON(invalid); err == nil {
			t.Fatalf("accepted invalid configuration %q", invalid)
		}
		if !bytes.Equal(lastConfigJSON, saved) || !strings.EqualFold(executor.GetGeneral().Mode.String(), "direct") {
			t.Fatal("rejected configuration replaced committed configuration state")
		}
	}
	if androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("rejected configuration reopened socket/tunnel admission")
	}
}

type bridgeEpochRawConn struct {
	controls int
}

func (c *bridgeEpochRawConn) Control(f func(uintptr)) error {
	c.controls++
	f(42)
	return nil
}

func (c *bridgeEpochRawConn) Read(func(uintptr) bool) error  { return nil }
func (c *bridgeEpochRawConn) Write(func(uintptr) bool) error { return nil }

var _ syscall.RawConn = (*bridgeEpochRawConn)(nil)

func assertAndroidBridgeEpochAdmission(t *testing.T, oldEpoch uint64) {
	t.Helper()
	oldConn := &bridgeEpochRawConn{}
	oldProtects := 0
	if err := androidRuntime.socketHookAtEpoch(oldEpoch, oldConn, func(int) bool {
		oldProtects++
		return true
	}); err == nil {
		t.Fatal("stale epoch was admitted")
	}
	if oldConn.controls != 0 || oldProtects != 0 {
		t.Fatalf("stale epoch touched socket: controls=%d protects=%d", oldConn.controls, oldProtects)
	}

	newConn := &bridgeEpochRawConn{}
	newProtects := 0
	if err := androidRuntime.socketHookAtEpoch(androidRuntime.epoch.Load(), newConn, func(fd int) bool {
		if fd != 42 {
			t.Fatalf("unexpected fake fd %d", fd)
		}
		newProtects++
		return true
	}); err != nil {
		t.Fatalf("current epoch was rejected: %v", err)
	}
	if newConn.controls != 1 || newProtects != 1 {
		t.Fatalf("current epoch did not protect once: controls=%d protects=%d", newConn.controls, newProtects)
	}
}

func TestAndroidBridgeConfigurationInvalidatesOldEpoch(t *testing.T) {
	constant.SetHomeDir(t.TempDir())
	androidRuntime = androidTunLifecycle{}
	androidRuntime.protected.Store(true)
	oldEpoch := androidRuntime.epoch.Load()
	cfg, err := config.Parse([]byte(`{"mode":"rule","log-level":"silent","geo-auto-update":false,"rules":["MATCH,DIRECT"],"dns":{"enable":false},"tun":{"enable":false},"ntp":{"enable":false}}`))
	if err != nil {
		t.Fatal(err)
	}
	applyAndroidConfiguration(cfg)
	// Model the newly configured runtime becoming ready after the transition.
	androidRuntime.protected.Store(true)
	assertAndroidBridgeEpochAdmission(t, oldEpoch)
	if androidRuntime.epoch.Load() == oldEpoch {
		t.Fatal("configuration did not advance the epoch")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

func TestAndroidBridgeFailedReplacementInvalidatesOldEpoch(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	failure := errors.New("replacement close failure")
	androidRuntime.listener = &bridgeTestListener{err: failure}
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	oldEpoch := androidRuntime.epoch.Load()
	if startTUN(-1, nil, nil, nil) != 0 {
		t.Fatal("failed replacement was accepted")
	}
	if androidRuntime.listener == nil || androidRuntime.protected.Load() {
		t.Fatal("failed replacement lost cleanup ownership or reopened admission")
	}
	// Model the replacement runtime becoming ready independently of failed cleanup.
	androidRuntime.protected.Store(true)
	assertAndroidBridgeEpochAdmission(t, oldEpoch)
	androidRuntime.listener.(*bridgeTestListener).err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

func TestAndroidBridgeFailedStopInvalidatesOldEpoch(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	failure := errors.New("stop close failure")
	listener := &bridgeTestListener{err: failure}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	oldEpoch := androidRuntime.epoch.Load()
	if err := stopTunError(); !errors.Is(err, failure) {
		t.Fatalf("stop error = %v", err)
	}
	// Model a new runtime becoming ready even though the old listener needs retry.
	androidRuntime.protected.Store(true)
	assertAndroidBridgeEpochAdmission(t, oldEpoch)
	listener.err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

// CI copies this file into the dedicated library package in the pinned upstream
// module (only the bridge's android build constraint is removed for host cgo).
// Tests exercise actual executor.ApplyConfig/tunnel state, not an Android TUN,
// VpnService, a packet data path, or full-core shutdown.
func TestAndroidBridgeConfigurationPreservesAdmissionState(t *testing.T) {
	constant.SetHomeDir(t.TempDir())
	for _, ready := range []bool{false, true} {
		androidRuntime = androidTunLifecycle{}
		androidRuntime.protected.Store(ready)
		cfg, err := config.Parse([]byte(`{"mode":"rule","log-level":"silent","geo-auto-update":false,"rules":["MATCH,DIRECT"],"dns":{"enable":false},"tun":{"enable":false},"ntp":{"enable":false}}`))
		if err != nil {
			t.Fatal(err)
		}
		applyAndroidConfiguration(cfg)
		if androidRuntime.protected.Load() != ready {
			t.Fatal("configuration changed socket admission")
		}
		if ready && tunnel.Status() != tunnel.Running {
			t.Fatal("active configuration failed to resume the tunnel")
		}
		if !ready && tunnel.Status() != tunnel.Suspend {
			t.Fatal("configuration resumed an unattached/stopped tunnel")
		}
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

type bridgeTestListener struct {
	err    error
	closes int
}

func (l *bridgeTestListener) Close() error {
	l.closes++
	if tunnel.Status() != tunnel.Suspend {
		return errors.New("listener closed before tunnel admission was suspended")
	}
	return l.err
}

func TestAndroidBridgeStopTreatsClosedListenerAsReleased(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	listener := &bridgeTestListener{err: net.ErrClosed}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if err := stopTunError(); err != nil {
		t.Fatalf("already-closed listener stop failed: %v", err)
	}
	if androidRuntime.listener != nil || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("already-closed listener ownership was not released")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("idempotent stop failed: %v", err)
	}
	if listener.err != net.ErrClosed || listener.closes != 1 {
		t.Fatal("already-closed listener was retried after successful release")
	}
}

func TestAndroidBridgeStopRetainsMixedListenerCloseErrorForRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	failure := errors.New("listener close failure")
	listener := &bridgeTestListener{err: errors.Join(net.ErrClosed, failure)}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if err := stopTunError(); !errors.Is(err, failure) {
		t.Fatalf("mixed listener error was lost: %v", err)
	}
	if androidRuntime.listener != listener || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("mixed listener failure was not retained for retry")
	}
	listener.err = nil
	if err := stopTunError(); err != nil {
		t.Fatalf("listener retry failed: %v", err)
	}
	if androidRuntime.listener != nil {
		t.Fatal("successful listener retry retained ownership")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("post-retry stop was not idempotent: %v", err)
	}
}

func TestAndroidBridgeStopSuspendsAndRetainsRetryOwnership(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	failure := errors.New("test close failure")
	listener := &bridgeTestListener{err: failure}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if err := stopTunError(); !errors.Is(err, failure) {
		t.Fatalf("lost close failure: %v", err)
	}
	if androidRuntime.listener != listener || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed stop lost ownership or left admission open")
	}
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume reopened a failed-stop runtime")
	}
	listener.err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if androidRuntime.listener != nil {
		t.Fatal("retry did not release the listener")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

func TestAndroidBridgeInvalidTunStartStaysSuspended(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if startTUN(-1, nil, nil, nil) != 0 {
		t.Fatal("invalid TUN descriptor was accepted")
	}
	if androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed start left admission open")
	}
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume reopened a failed-start runtime")
	}
}

// These loopback sockets are deliberately constructed with net, not Mihomo's
// protected dialer: the test exercises real tracker/socket cleanup, not Android
// protection or TUN routing. Both sockets carry data before the transition.
func TestAndroidBridgeStopClosesCapturedTCPAndUDP(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		replacement, alreadyClosed bool
	}{
		{"stop", false, false},
		{"replacement", true, false},
		{"stop already closed", false, true},
		{"replacement already closed", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			tcp, err := net.DialTimeout("tcp4", listener.Addr().String(), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer tcp.Close()
			if err := listener.(*net.TCPListener).SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			peer, err := listener.Accept()
			if err != nil {
				t.Fatal(err)
			}
			defer peer.Close()
			if err := peer.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			udp, err := net.ListenPacket("udp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer udp.Close()
			if err := udp.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "cleanup-test"})
			tcpTracker := statistic.NewTCPTracker(outbound.NewConn(tcp, direct), statistic.DefaultManager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true)
			udpTracker := statistic.NewUDPTracker(outbound.NewPacketConn(udp, direct), statistic.DefaultManager, &constant.Metadata{NetWork: constant.UDP}, nil, 0, 0, true)
			defer tcpTracker.Close()
			defer udpTracker.Close()
			if _, err := tcpTracker.Write([]byte{42}); err != nil {
				t.Fatal(err)
			}
			var data [1]byte
			if _, err := io.ReadFull(peer, data[:]); err != nil || data[0] != 42 {
				t.Fatalf("TCP pre-stop traffic failed: %v", err)
			}
			if _, err := udpTracker.WriteTo([]byte{43}, udp.LocalAddr()); err != nil {
				t.Fatal(err)
			}
			if _, _, err := udpTracker.ReadFrom(data[:]); err != nil || data[0] != 43 {
				t.Fatalf("UDP pre-stop traffic failed: %v", err)
			}
			if tc.alreadyClosed {
				// Deterministically model the already-closed socket state that a
				// concurrent worker can leave when snapshot cleanup reaches it.
				if err := tcp.Close(); err != nil {
					t.Fatal(err)
				}
				if err := udp.Close(); err != nil {
					t.Fatal(err)
				}
			}
			androidRuntime.protected.Store(true)
			tunnel.OnRunning()
			if tc.replacement {
				if startTUN(-1, nil, nil, nil) != 0 {
					t.Fatal("invalid replacement was accepted")
				}
			} else if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
			if statistic.DefaultManager.Get(tcpTracker.ID()) != nil || statistic.DefaultManager.Get(udpTracker.ID()) != nil {
				t.Fatal("captured trackers remained registered")
			}
			if len(androidRuntime.pendingConnections) != 0 || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
				t.Fatal("cleanup left pending ownership or reopened admission")
			}
			if _, err := tcp.Write(data[:]); !errors.Is(err, net.ErrClosed) {
				t.Fatalf("underlying TCP socket not closed: %v", err)
			}
			if _, _, err := udp.ReadFrom(data[:]); !errors.Is(err, net.ErrClosed) {
				t.Fatalf("underlying UDP socket not closed: %v", err)
			}
			if _, err := peer.Read(data[:]); err != io.EOF {
				t.Fatalf("TCP peer did not observe closure: %v", err)
			}
			if err := stopTunError(); err != nil {
				t.Fatalf("repeat stop: %v", err)
			}
		})
	}
}

type bridgeRetryConn struct {
	constant.Conn
	err    error
	closes int
}

func (c *bridgeRetryConn) Close() error {
	c.closes++
	if c.err != nil {
		return c.err
	}
	return c.Conn.Close()
}

func TestAndroidBridgeStopRetainsUnregisteredFailedTracker(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	local, peer := net.Pipe()
	defer local.Close()
	defer peer.Close()
	direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "retry-test"})
	closeFailure := errors.New("underlying connection close failed")
	conn := &bridgeRetryConn{Conn: outbound.NewConn(local, direct), err: closeFailure}
	tracker := statistic.NewTCPTracker(conn, statistic.DefaultManager, &constant.Metadata{}, nil, 0, 0, true)
	defer func() {
		conn.err = nil
		_ = tracker.Close()
	}()
	listenerFailure := errors.New("listener close failed")
	listener := &bridgeTestListener{err: listenerFailure}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	err := stopTunError()
	if !errors.Is(err, closeFailure) || !errors.Is(err, listenerFailure) {
		t.Fatalf("stop failed to report both cleanup errors: %v", err)
	}
	// Adapted real trackers retain registration on a genuine close failure.
	if statistic.DefaultManager.Get(tracker.ID()) != tracker || androidRuntime.pendingConnections[tracker.ID()] != tracker || conn.closes != 1 {
		t.Fatal("failed tracker lost manager or bridge retry ownership")
	}
	// An independent upstream removal must still not discard the bridge's owner.
	statistic.DefaultManager.Leave(tracker)
	if statistic.DefaultManager.Get(tracker.ID()) != nil || androidRuntime.pendingConnections[tracker.ID()] != tracker {
		t.Fatal("unregistered failed tracker lost independent retry ownership")
	}
	if androidRuntime.listener != listener || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed cleanup lost listener or reopened admission")
	}
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume reopened failed cleanup")
	}
	listener.err = nil
	conn.err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.pendingConnections) != 0 || androidRuntime.listener != nil || conn.closes != 2 {
		t.Fatal("retry did not release both failed resources")
	}
	if err := stopTunError(); err != nil || conn.closes != 2 {
		t.Fatal("successful cleanup was not idempotent")
	}
}

// Holding the same mutex used by config.Parse/ApplyConfig models a slow control
// operation deterministically. Stop must gate hooks before that mutex is free;
// the test does not pretend to cancel the operation which owns the mutex.
func TestAndroidBridgeQueuedStopBlocksBeforeControlLock(t *testing.T) {
	for _, stops := range []int{1, 2} {
		for _, closeFails := range []bool{false, true} {
			t.Run(fmt.Sprintf("stops=%d/closeFails=%t", stops, closeFails), func(t *testing.T) {
				androidRuntime = androidTunLifecycle{}
				androidRuntime.protected.Store(true)
				tunnel.OnRunning()
				failure := errors.New("queued stop close failed")
				listener := &bridgeTestListener{}
				if closeFails {
					listener.err = failure
				}
				androidRuntime.listener = listener
				androidTunMu.Lock()
				locked := true
				done := make(chan error, stops)
				// Always release and join workers before t.TempDir or the next
				// test can change package-global state, including assertion failures.
				completed := 0
				defer func() {
					if locked {
						androidTunMu.Unlock()
					}
					for completed < stops {
						<-done
						completed++
					}
					listener.err = nil
					_ = stopTunError()
				}()
				for i := 0; i < stops; i++ {
					go func() { done <- stopTunError() }()
				}
				deadline := time.Now().Add(5 * time.Second)
				for androidRuntime.pendingStops.Load() != int64(stops) {
					if time.Now().After(deadline) {
						t.Fatal("stops did not announce themselves before waiting for the control lock")
					}
					time.Sleep(time.Millisecond)
				}
				conn := &bridgeEpochRawConn{}
				if err := androidRuntime.socketHook(conn, func(int) bool {
					t.Error("stop queued behind configuration invoked protection")
					return true
				}); err == nil || conn.controls != 0 {
					t.Fatal("stop queued behind configuration admitted a socket")
				}
				if listener.closes != 0 {
					t.Fatal("stop touched owned resources without the control lock")
				}
				// The operation currently owning the lock is allowed to finish,
				// but it must not restore admission over either queued stop.
				androidRuntime.restoreAdmission(true)
				if androidRuntime.ready() || androidRuntime.protected.Load() {
					t.Fatal("readiness restoration overrode queued stop")
				}
				androidTunMu.Unlock()
				locked = false
				for completed < stops {
					select {
					case err := <-done:
						completed++
						if closeFails && !errors.Is(err, failure) || !closeFails && err != nil {
							t.Fatalf("queued stop result: %v", err)
						}
					case <-time.After(5 * time.Second):
						t.Fatal("queued stop did not finish after control lock release")
					}
				}
				if androidRuntime.pendingStops.Load() != 0 || androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
					t.Fatal("completed stop left pending requests or reopened admission")
				}
				if closeFails && androidRuntime.listener != listener {
					t.Fatal("queued stop lost failed cleanup ownership")
				}
				suspend(0)
				if tunnel.Status() != tunnel.Suspend {
					t.Fatal("resume reopened a completed/failed stop")
				}
			})
		}
	}
}

func TestAndroidBridgeApplyCannotResumePendingStop(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	constant.SetHomeDir(t.TempDir())
	cfg, err := config.Parse(bridgeConfigJSON("rule"))
	if err != nil {
		t.Fatal(err)
	}
	androidRuntime.beginStop()
	defer androidRuntime.endStop()
	androidRuntime.protected.Store(true) // Model construction which started earlier.
	applyAndroidConfiguration(cfg)
	if androidRuntime.ready() || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("upstream apply resumed a runtime with a pending stop")
	}
	androidRuntime.protected.Store(true)
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("explicit resume ignored a pending stop")
	}
	if startTUN(-1, nil, nil, nil) != 0 || androidRuntime.ready() {
		t.Fatal("replacement ignored a pending stop")
	}
}

// Suspending the packet ingress alone does not stop provider/DNS/background
// dialers from reaching DefaultSocketHook. Explicit pause must also gate hooks.
func TestAndroidBridgeSuspendClosesSocketAdmission(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	t.Cleanup(func() { _ = stopTunError() })
	oldEpoch := androidRuntime.epoch.Load()
	suspend(1)
	conn := &bridgeEpochRawConn{}
	protects := 0
	protect := func(int) bool { protects++; return true }
	if err := androidRuntime.socketHook(conn, protect); err == nil || conn.controls != 0 || protects != 0 {
		t.Fatal("explicit suspend admitted a new socket")
	}
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("explicit suspend left tunnel running")
	}
	constant.SetHomeDir(t.TempDir())
	cfg, err := config.Parse(bridgeConfigJSON("rule"))
	if err != nil {
		t.Fatal(err)
	}
	applyAndroidConfiguration(cfg)
	if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("configuration reopened explicitly suspended admission")
	}
	suspend(0)
	if !androidRuntime.ready() || tunnel.Status() != tunnel.Running {
		t.Fatal("explicit resume did not restore a ready runtime")
	}
	assertAndroidBridgeEpochAdmission(t, oldEpoch)
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	suspend(0)
	if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume after stop invented readiness")
	}
}

func TestAndroidBridgePausedFailedReplacementDoesNotResume(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	t.Cleanup(func() { _ = stopTunError() })
	suspend(1)
	if startTUN(-1, nil, nil, nil) != 0 {
		t.Fatal("invalid replacement was accepted")
	}
	if !androidRuntime.suspended.Load() || androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed replacement cleared explicit pause or reopened admission")
	}
	suspend(0)
	if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume after failed replacement invented readiness")
	}
}

func TestAndroidBridgeQueuedSuspendBlocksBeforeControlLock(t *testing.T) {
	for _, pauses := range []int{1, 2} {
		t.Run(fmt.Sprintf("pauses=%d", pauses), func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			androidRuntime.protected.Store(true)
			tunnel.OnRunning()
			oldEpoch := androidRuntime.epoch.Load()
			listener := &bridgeTestListener{}
			androidRuntime.listener = listener
			androidTunMu.Lock()
			locked := true
			done := make(chan struct{}, pauses)
			completed := 0
			defer func() {
				if locked {
					androidTunMu.Unlock()
				}
				for completed < pauses {
					<-done
					completed++
				}
				_ = stopTunError()
			}()
			for i := 0; i < pauses; i++ {
				go func() { suspend(1); done <- struct{}{} }()
			}
			deadline := time.Now().Add(5 * time.Second)
			for androidRuntime.pendingSuspends.Load() != int64(pauses) {
				if time.Now().After(deadline) {
					t.Fatal("pauses did not announce before waiting for control lock")
				}
				time.Sleep(time.Millisecond)
			}
			// Model an operation already owning the lock clearing pause while
			// finishing config/start/resume. It cannot bypass queued requests.
			androidRuntime.setSuspended(false)
			androidRuntime.restoreAdmission(true)
			conn := &bridgeEpochRawConn{}
			if err := androidRuntime.socketHook(conn, func(int) bool {
				t.Error("queued pause invoked protection")
				return true
			}); err == nil || conn.controls != 0 {
				t.Fatal("pause queued behind configuration admitted a socket")
			}
			if listener.closes != 0 || androidRuntime.listener != listener {
				t.Fatal("queued pause changed resource ownership")
			}
			androidTunMu.Unlock()
			locked = false
			for completed < pauses {
				select {
				case <-done:
					completed++
				case <-time.After(5 * time.Second):
					t.Fatal("queued pause did not finish after control lock release")
				}
			}
			if androidRuntime.pendingSuspends.Load() != 0 || androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
				t.Fatal("completed pause leaked a request or reopened admission")
			}
			if !androidRuntime.protected.Load() || androidRuntime.listener != listener || listener.closes != 0 {
				t.Fatal("pause discarded protection or listener ownership")
			}
			suspend(0)
			if !androidRuntime.ready() || tunnel.Status() != tunnel.Running {
				t.Fatal("explicit resume after queued pause failed")
			}
			assertAndroidBridgeEpochAdmission(t, oldEpoch)
		})
	}
}

// Exercise both real entry bodies while stop is pending and the control mutex
// is unavailable. The early rejection must not wait for the mutex or parse.
func TestAndroidBridgePendingStopRejectsConfigurationBeforeControlLock(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
		t.Fatal(err)
	}
	saved := append([]byte(nil), lastConfigJSON...)
	androidRuntime.beginStop()
	androidTunMu.Lock()
	locked := true
	done := make(chan error, 2)
	completed := 0
	defer func() {
		if locked {
			androidTunMu.Unlock()
		}
		for completed < 2 {
			<-done
			completed++
		}
		androidRuntime.endStop()
		_ = stopTunError()
	}()
	go func() { done <- applyAndroidConfigJSON(bridgeConfigJSON("rule")) }()
	go func() { done <- updateAndroidDNS("127.0.0.1") }()
	for completed < 2 {
		select {
		case err := <-done:
			completed++
			if !errors.Is(err, errAndroidConfigurationStopped) {
				t.Fatalf("configuration result: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("configuration waited for control despite pending stop")
		}
	}
	androidTunMu.Unlock()
	locked = false
	if !bytes.Equal(lastConfigJSON, saved) || !strings.EqualFold(executor.GetGeneral().Mode.String(), "direct") {
		t.Fatal("pending stop changed committed configuration")
	}
	if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("rejected updates reopened admission")
	}
}

// Explicit captured tokens model requests paused before lock acquisition without
// scheduler sleeps. Once stop returns its count is zero, but these requests must
// not parse/apply or replace saved JSON. A genuinely fresh request remains valid.
func TestAndroidBridgeCompletedStopRejectsStaleConfigurationGeneration(t *testing.T) {
	for _, operation := range []string{"config", "dns"} {
		t.Run(operation, func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			lastConfigJSON = nil
			if err := initializeAndroid(t.TempDir()); err != nil {
				t.Fatal(err)
			}
			defer stopTunError()
			if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
				t.Fatal(err)
			}
			saved := append([]byte(nil), lastConfigJSON...)
			generation := androidRuntime.stopGeneration.Load()
			if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
			if androidRuntime.pendingStops.Load() != 0 {
				t.Fatal("stop did not complete")
			}
			var err error
			if operation == "config" {
				err = applyAndroidConfigJSONAtGeneration(bridgeConfigJSON("rule"), generation)
			} else {
				err = updateAndroidDNSAtGeneration("127.0.0.1", generation)
			}
			if !errors.Is(err, errAndroidConfigurationStopped) {
				t.Fatalf("stale request result: %v", err)
			}
			if !bytes.Equal(lastConfigJSON, saved) || !strings.EqualFold(executor.GetGeneral().Mode.String(), "direct") {
				t.Fatal("stale update changed committed configuration")
			}
			if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
				t.Fatal("stale update reopened stopped runtime")
			}
			if operation == "config" {
				err = applyAndroidConfigJSON(bridgeConfigJSON("rule"))
			} else {
				err = updateAndroidDNS("127.0.0.1")
			}
			if err != nil {
				t.Fatalf("fresh request rejected: %v", err)
			}
			if bytes.Equal(lastConfigJSON, saved) {
				t.Fatal("fresh request failed to commit")
			}
			if androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
				t.Fatal("fresh configuration invented TUN readiness")
			}
		})
	}
}

// A pending stop must reject the actual export without waiting for a parser's
// control lock. Rejection must not touch listener or tracker ownership.
func TestAndroidBridgePendingStopRejectsStartBeforeControlLock(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	listener := &bridgeTestListener{}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	androidRuntime.beginStop()
	androidTunMu.Lock()
	locked := true
	done := make(chan bool, 1)
	completed := false
	defer func() {
		if locked {
			androidTunMu.Unlock()
		}
		if !completed {
			<-done
		}
		androidRuntime.endStop()
		_ = stopTunError()
	}()
	go func() { done <- startTUN(-1, nil, nil, nil) != 0 }()
	select {
	case accepted := <-done:
		completed = true
		if accepted {
			t.Fatal("start accepted during pending stop")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("start waited for control lock despite pending stop")
	}
	if listener.closes != 0 || androidRuntime.listener != listener {
		t.Fatal("rejected start changed cleanup ownership")
	}
	androidTunMu.Unlock()
	locked = false
}

// Explicit tokens model a start paused before lock acquisition. A newer runtime
// can already own resources when this stale request eventually gets the lock.
// No real Android TUN is constructed: even an invalid fresh replacement normally
// performs old-resource cleanup, making stale-start rejection observable here.
func TestAndroidBridgeCompletedStopRejectsStaleStartBeforeCleanup(t *testing.T) {
	for _, closeFails := range []bool{false, true} {
		t.Run(fmt.Sprintf("closeFails=%t", closeFails), func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			generation := androidRuntime.stopGeneration.Load()
			if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
			listener := &bridgeTestListener{}
			if closeFails {
				listener.err = errors.New("newer listener must not be closed by stale start")
			}
			androidRuntime.listener = listener
			androidRuntime.protected.Store(true)
			androidRuntime.setSuspended(true)
			tunnel.OnSuspend()
			local, peer := net.Pipe()
			defer local.Close()
			defer peer.Close()
			direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "stale-start-test"})
			tracked := &bridgeRetryConn{Conn: outbound.NewConn(local, direct)}
			tracker := statistic.NewTCPTracker(tracked, statistic.DefaultManager, &constant.Metadata{}, nil, 0, 0, true)
			defer tracker.Close()
			defer func() { listener.err = nil; _ = stopTunError() }()
			var fds [2]int
			if err := syscall.Pipe(fds[:]); err != nil {
				t.Fatal(err)
			}
			defer syscall.Close(fds[0])
			defer syscall.Close(fds[1])
			epoch := androidRuntime.epoch.Load()
			if startAndroidTUNAtGeneration(fds[0], "system", "invalid-prefix", "", generation) {
				t.Fatal("stale start accepted after completed stop")
			}
			if listener.closes != 0 || androidRuntime.listener != listener || tracked.closes != 0 || statistic.DefaultManager.Get(tracker.ID()) != tracker {
				t.Fatal("stale start closed or discarded newer resources")
			}
			if !androidRuntime.protected.Load() || !androidRuntime.suspended.Load() || androidRuntime.epoch.Load() != epoch || tunnel.Status() != tunnel.Suspend {
				t.Fatal("stale start changed newer admission or pause state")
			}
			if _, err := syscall.Write(fds[1], []byte{42}); err != nil {
				t.Fatal(err)
			}
			var data [1]byte
			if n, err := syscall.Read(fds[0], data[:]); err != nil || n != 1 || data[0] != 42 {
				t.Fatalf("stale start consumed caller descriptor: n=%d err=%v", n, err)
			}
			// A new request at the current generation must reach replacement
			// cleanup, even though its deliberately invalid fd cannot attach.
			listener.err = nil
			if startAndroidTUNAtGeneration(-1, "", "", "", androidRuntime.stopGeneration.Load()) {
				t.Fatal("invalid fresh start accepted")
			}
			if listener.closes != 1 || androidRuntime.listener != nil || tracked.closes != 1 || androidRuntime.protected.Load() {
				t.Fatal("fresh start was rejected before normal replacement cleanup")
			}
		})
	}
}

// The constructor owns only the duplicate, like sing_tun.New. A failed Close
// deliberately retains it so both the bridge and queued stop must keep ownership.
type bridgeConstructedListener struct {
	fd     int
	closes int
	err    error
}

func (l *bridgeConstructedListener) Close() error {
	l.closes++
	if l.err != nil {
		return l.err
	}
	return syscall.Close(l.fd)
}

func TestAndroidBridgeStopDuringConstructionPreservesCallerFD(t *testing.T) {
	for _, closeFails := range []bool{false, true} {
		t.Run(fmt.Sprintf("closeFails=%t", closeFails), func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			androidRuntime.setSuspended(true)
			tunnel.OnSuspend()
			var fds [2]int
			if err := syscall.Pipe(fds[:]); err != nil {
				t.Fatal(err)
			}
			defer syscall.Close(fds[0])
			defer syscall.Close(fds[1])
			failure := errors.New("constructed listener close failed")
			listener := &bridgeConstructedListener{fd: -1}
			if closeFails {
				listener.err = failure
			}
			entered := make(chan struct{})
			release := make(chan struct{})
			startDone := make(chan bool, 1)
			stopDone := make(chan error, 1)
			var releaseOnce sync.Once
			startJoined, stopStarted, stopJoined := false, false, false
			defer func() {
				releaseOnce.Do(func() { close(release) })
				if !startJoined {
					<-startDone
				}
				if stopStarted && !stopJoined {
					<-stopDone
				}
				listener.err = nil
				_ = stopTunError()
			}()
			generation := androidRuntime.stopGeneration.Load()
			go func() {
				startDone <- startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", generation, func(options LC.Tun) (io.Closer, error) {
					listener.fd = options.FileDescriptor
					close(entered)
					<-release
					return listener, nil
				})
			}()
			select {
			case <-entered:
			case <-time.After(5 * time.Second):
				t.Fatal("constructor was not reached")
			}
			stopStarted = true
			go func() { stopDone <- stopTunError() }()
			deadline := time.Now().Add(5 * time.Second)
			for androidRuntime.pendingStops.Load() != 1 {
				if time.Now().After(deadline) {
					t.Fatal("stop did not announce during construction")
				}
				time.Sleep(time.Millisecond)
			}
			conn := &bridgeEpochRawConn{}
			if err := androidRuntime.socketHook(conn, func(int) bool { t.Error("protection called during stop"); return true }); err == nil || conn.controls != 0 {
				t.Fatal("construction admitted a socket over stop")
			}
			releaseOnce.Do(func() { close(release) })
			accepted := <-startDone
			startJoined = true
			stopErr := <-stopDone
			stopJoined = true
			if accepted {
				t.Fatal("construction superseded by stop reported startup success")
			}
			if closeFails && !errors.Is(stopErr, failure) || !closeFails && stopErr != nil {
				t.Fatalf("stop result: %v", stopErr)
			}
			if androidRuntime.ready() || androidRuntime.protected.Load() || !androidRuntime.suspended.Load() || tunnel.Status() != tunnel.Suspend {
				t.Fatal("rejected construction changed pause or reopened admission")
			}
			if _, err := syscall.Write(fds[1], []byte{42}); err != nil {
				t.Fatal(err)
			}
			var data [1]byte
			if n, err := syscall.Read(fds[0], data[:]); err != nil || n != 1 || data[0] != 42 {
				t.Fatalf("rejected construction consumed caller descriptor: n=%d err=%v", n, err)
			}
			var stat syscall.Stat_t
			if closeFails {
				if androidRuntime.listener != listener || listener.closes != 2 {
					t.Fatal("failed construction cleanup was not retained and retried by queued stop")
				}
				if err := syscall.Fstat(listener.fd, &stat); err != nil {
					t.Fatalf("failed cleanup discarded duplicate: %v", err)
				}
				listener.err = nil
				if err := stopTunError(); err != nil {
					t.Fatal(err)
				}
				if listener.closes != 3 {
					t.Fatal("fresh stop did not retry retained listener")
				}
			} else if listener.closes != 1 {
				t.Fatalf("listener closed %d times", listener.closes)
			}
			if androidRuntime.listener != nil {
				t.Fatal("successful cleanup retained listener")
			}
			if err := syscall.Fstat(listener.fd, &stat); !errors.Is(err, syscall.EBADF) {
				t.Fatalf("duplicate survived successful cleanup: %v", err)
			}
		})
	}
}

func TestAndroidBridgeFreshConstructionCommitsCallerFD(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	androidRuntime.setSuspended(true)
	tunnel.OnSuspend()
	var fds [2]int
	if err := syscall.Pipe(fds[:]); err != nil {
		t.Fatal(err)
	}
	callerOwned := true
	defer func() {
		if callerOwned {
			_ = syscall.Close(fds[0])
		}
		_ = syscall.Close(fds[1])
		_ = stopTunError()
	}()
	listener := &bridgeConstructedListener{fd: -1}
	accepted := startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		listener.fd = options.FileDescriptor
		return listener, nil
	})
	if !accepted {
		t.Fatal("fresh construction was rejected")
	}
	callerOwned = false
	var stat syscall.Stat_t
	if err := syscall.Fstat(fds[0], &stat); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("committed caller descriptor not released: %v", err)
	}
	if err := syscall.Fstat(listener.fd, &stat); err != nil {
		t.Fatalf("committed duplicate not retained: %v", err)
	}
	if androidRuntime.listener != listener || !androidRuntime.ready() || androidRuntime.suspended.Load() || tunnel.Status() != tunnel.Running {
		t.Fatal("fresh construction failed to commit listener and admission")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if listener.closes != 1 || androidRuntime.listener != nil {
		t.Fatal("committed listener cleanup failed")
	}
	if err := syscall.Fstat(listener.fd, &stat); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("committed duplicate survived stop: %v", err)
	}
}

// Closing a process-wide standard fd must never affect other tests or workers.
// The child exercises the real startup body with a synthetic pipe listener.
func TestAndroidBridgeConstructionWithClosedStdin(t *testing.T) {
	const childEnv = "ANGELANEXUS_TEST_CLOSED_STDIN"
	mode := os.Getenv(childEnv)
	if mode != "success" && mode != "failure" {
		for _, childMode := range []string{"success", "failure"} {
			cmd := exec.Command(os.Args[0], "-test.run=^TestAndroidBridgeConstructionWithClosedStdin$", "-test.timeout=20s")
			cmd.Env = append(os.Environ(), childEnv+"="+childMode)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("closed-stdin %s child: %v\n%s", childMode, err, output)
			}
		}
		return
	}
	androidRuntime = androidTunLifecycle{}
	tunnel.OnSuspend()
	var fds [2]int
	if err := syscall.Pipe(fds[:]); err != nil {
		t.Fatal(err)
	}
	callerOwned := true
	defer func() {
		if callerOwned {
			_ = syscall.Close(fds[0])
		}
		_ = syscall.Close(fds[1])
		_ = stopTunError()
	}()
	if err := syscall.Close(0); err != nil {
		t.Fatal(err)
	}
	listener := &bridgeConstructedListener{fd: -1}
	validFD, closeOnExec := false, false
	accepted := startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		listener.fd = options.FileDescriptor
		validFD = listener.fd >= 3
		flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(listener.fd), syscall.F_GETFD, 0)
		closeOnExec = errno == 0 && flags&syscall.FD_CLOEXEC != 0
		if mode == "failure" {
			_ = syscall.Close(listener.fd)
			return nil, errors.New("synthetic failure before fd adoption")
		}
		return listener, nil
	})
	if accepted {
		callerOwned = false
	}
	if !validFD {
		t.Fatalf("constructor received sentinel/standard descriptor %d", listener.fd)
	}
	if !closeOnExec {
		t.Fatal("TUN duplicate is inheritable across exec")
	}
	var stat syscall.Stat_t
	if mode == "failure" {
		if accepted || androidRuntime.listener != nil || androidRuntime.ready() {
			t.Fatal("failed construction committed runtime state")
		}
		if err := syscall.Fstat(fds[0], &stat); err != nil {
			t.Fatalf("failed construction consumed caller descriptor: %v", err)
		}
		if err := syscall.Fstat(listener.fd, &stat); !errors.Is(err, syscall.EBADF) {
			t.Fatalf("unused duplicate survived failed construction: %v", err)
		}
		return
	}
	if !accepted {
		t.Fatal("fresh construction was rejected with stdin closed")
	}
	if err := syscall.Fstat(fds[0], &stat); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("successful start did not consume caller fd: %v", err)
	}
	if _, err := syscall.Write(fds[1], []byte{42}); err != nil {
		t.Fatal(err)
	}
	var data [1]byte
	if n, err := syscall.Read(listener.fd, data[:]); err != nil || n != 1 || data[0] != 42 {
		t.Fatalf("constructor did not retain the caller's pipe: n=%d err=%v", n, err)
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if listener.closes != 1 || androidRuntime.listener != nil {
		t.Fatal("stop did not release constructed listener exactly once")
	}
	if err := syscall.Fstat(listener.fd, &stat); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("duplicate survived stop: %v", err)
	}
}

// Each child owns its descriptor table: forcing reuse must not replace another
// test's socket. The real upstream cases fail before and after tun.New adoption;
// pipes stand in for supplied descriptors, not a working Android TUN device.
func TestAndroidBridgeConstructorFailureDoesNotCloseReusedFD(t *testing.T) {
	const childEnv = "ANGELANEXUS_TEST_OWNED_FD_FAILURE"
	mode := os.Getenv(childEnv)
	if mode == "" {
		for _, childMode := range []string{"synthetic", "upstream-early", "upstream-late"} {
			cmd := exec.Command(os.Args[0], "-test.run=^TestAndroidBridgeConstructorFailureDoesNotCloseReusedFD$", "-test.timeout=20s")
			cmd.Env = append(os.Environ(), childEnv+"="+childMode)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("owned-fd %s child: %v\n%s", childMode, err, output)
			}
		}
		return
	}
	androidRuntime = androidTunLifecycle{}
	tunnel.OnSuspend()
	var caller, replacement [2]int
	if err := syscall.Pipe(caller[:]); err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(caller[0])
	defer syscall.Close(caller[1])
	if err := syscall.Pipe(replacement[:]); err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(replacement[0])
	defer syscall.Close(replacement[1])
	reusedFD := -1
	defer func() {
		if reusedFD >= 0 {
			_ = syscall.Close(reusedFD)
		}
		_ = stopTunError()
	}()
	accepted := startAndroidTUNWithConstructor(caller[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		reusedFD = options.FileDescriptor
		var constructorErr error
		switch mode {
		case "synthetic":
			constructorErr = syscall.Close(reusedFD)
			if constructorErr != nil {
				t.Fatal(constructorErr)
			}
			constructorErr = errors.New("synthetic consuming constructor failure")
		case "upstream-early", "upstream-late":
			if mode == "upstream-early" {
				options.DNSHijack = []string{"invalid-dns-address"}
			} else {
				options.Stack = constant.TUNStack(-1)
			}
			listener, err := sing_tun.NewWithOwnedFD(options, tunnel.Tunnel)
			if err == nil || listener != nil {
				if listener != nil {
					_ = listener.Close()
				}
				t.Fatalf("expected upstream constructor failure: listener=%v err=%v", listener, err)
			}
			constructorErr = err
			if mode == "upstream-early" && !strings.Contains(err.Error(), "dns-hijack") {
				t.Fatalf("did not reach early validation: %v", err)
			}
			if mode == "upstream-late" && !strings.Contains(err.Error(), "unknown stack") {
				t.Fatalf("did not reach post-adoption stack failure: %v", err)
			}
		default:
			t.Fatalf("unexpected child mode %q", mode)
		}
		var stat syscall.Stat_t
		if err := syscall.Fstat(reusedFD, &stat); !errors.Is(err, syscall.EBADF) {
			t.Fatalf("constructor failed without consuming duplicate: %v", err)
		}
		if err := unix.Dup3(replacement[0], reusedFD, unix.O_CLOEXEC); err != nil {
			t.Fatal(err)
		}
		return nil, constructorErr
	})
	if accepted || androidRuntime.listener != nil || androidRuntime.ready() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed construction committed listener or reopened admission")
	}
	// Both the immediate failure return and a later stop must leave reusedFD alone.
	for _, afterStop := range []bool{false, true} {
		if afterStop {
			if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
		}
		for _, pair := range [][2]int{{caller[0], caller[1]}, {reusedFD, replacement[1]}} {
			if _, err := syscall.Write(pair[1], []byte{42}); err != nil {
				t.Fatal(err)
			}
			var data [1]byte
			if n, err := syscall.Read(pair[0], data[:]); err != nil || n != 1 || data[0] != 42 {
				t.Fatalf("constructor failure closed caller/reused descriptor (afterStop=%t fd=%d): n=%d err=%v", afterStop, pair[0], n, err)
			}
		}
	}
}

// Observe the real upstream sampler across the bridge lifecycle. The tick wait
// tests sampling, not goroutine synchronization; the upstream package tests
// separately assert worker completion and serialization through its done channel.
func TestAndroidBridgeStatisticsLifecycle(t *testing.T) {
	for _, mode := range []string{"stop", "failed-stop", "invalid-replacement"} {
		t.Run(mode, func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			manager := statistic.DefaultManager
			manager.StopStatistics()
			manager.ResetStatistic()
			listener := &bridgeTestListener{}
			androidRuntime.listener = listener
			t.Cleanup(func() {
				listener.err = nil
				_ = stopTunError()
				manager.ResetStatistic()
			})
			waitSample := func(want int64) {
				t.Helper()
				deadline := time.NewTimer(4 * time.Second)
				defer deadline.Stop()
				poll := time.NewTicker(5 * time.Millisecond)
				defer poll.Stop()
				for {
					if up, _ := manager.Now(); up == want {
						return
					}
					select {
					case <-deadline.C:
						t.Fatalf("statistics did not sample %d uploaded bytes", want)
					case <-poll.C:
					}
				}
			}
			manager.StartStatistics()
			manager.PushUploaded(17)
			waitSample(17)
			switch mode {
			case "stop":
				if err := stopTunError(); err != nil {
					t.Fatal(err)
				}
			case "failed-stop":
				failure := errors.New("statistics listener close failure")
				listener.err = failure
				if err := stopTunError(); !errors.Is(err, failure) {
					t.Fatalf("failed stop: %v", err)
				}
			case "invalid-replacement":
				if startAndroidTUNAtGeneration(-1, "system", "", "", androidRuntime.stopGeneration.Load()) {
					t.Fatal("invalid replacement was accepted")
				}
			}
			if up, down := manager.Now(); up != 0 || down != 0 {
				t.Fatalf("cleanup did not join and clear sampler: up=%d down=%d", up, down)
			}
			manager.PushUploaded(19)
			if total, _ := manager.Total(); total != 36 {
				t.Fatalf("stop lost accumulated statistics: %d", total)
			}
			listener.err = nil
			if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
			// A consuming synthetic listener exercises the successful bridge path,
			// not a physical Android TUN. Failed replacement must not restart it.
			var fds [2]int
			if err := syscall.Pipe(fds[:]); err != nil {
				t.Fatal(err)
			}
			defer syscall.Close(fds[1])
			accepted := startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
				return os.NewFile(uintptr(options.FileDescriptor), "statistics-test-listener"), nil
			})
			if !accepted {
				_ = syscall.Close(fds[0])
				t.Fatal("synthetic attachment was rejected")
			}
			waitSample(19)
			if total, _ := manager.Total(); total != 36 {
				t.Fatalf("restart changed total statistics: %d", total)
			}
		})
	}
}

// These tests use the actual bridge cleanup/start bodies and real pipe sockets,
// but the consuming constructor is synthetic: no Android TUN is attached.
func TestAndroidBridgeLateConnectionEpochLifecycle(t *testing.T) {
	for _, mode := range []string{"stop", "failed-stop", "invalid-replacement"} {
		t.Run(mode, func(t *testing.T) {
			androidRuntime = androidTunLifecycle{}
			manager := statistic.DefaultManager
			manager.StartRegistrations()
			oldEpoch := manager.RegistrationEpoch()
			listener := &bridgeTestListener{}
			androidRuntime.listener = listener
			androidRuntime.protected.Store(true)
			tunnel.OnRunning()
			t.Cleanup(func() { listener.err = nil; _ = stopTunError() })
			failure := errors.New("late-connection listener failure")
			switch mode {
			case "stop":
				if err := stopTunError(); err != nil {
					t.Fatal(err)
				}
			case "failed-stop":
				listener.err = failure
				if err := stopTunError(); !errors.Is(err, failure) {
					t.Fatalf("lost listener failure: %v", err)
				}
			case "invalid-replacement":
				if startAndroidTUNAtGeneration(-1, "system", "", "", androidRuntime.stopGeneration.Load()) {
					t.Fatal("accepted invalid replacement")
				}
			}
			if manager.RegistrationEpoch() == oldEpoch {
				t.Fatal("cleanup did not invalidate the old tracker epoch")
			}
			probe := func(epoch uint64, admitted bool) {
				t.Helper()
				local, peer := net.Pipe()
				defer local.Close()
				defer peer.Close()
				direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "epoch-bridge-test"})
				tracker, err := statistic.NewTCPTrackerAtEpoch(outbound.NewConn(local, direct), manager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true, epoch)
				if admitted {
					if err != nil || tracker == nil {
						t.Fatalf("current epoch rejected: %v", err)
					}
					if manager.Get(tracker.ID()) != tracker {
						t.Fatal("admitted tracker not registered")
					}
					if err := tracker.Close(); err != nil {
						t.Fatal(err)
					}
					return
				}
				if err == nil || tracker != nil {
					t.Fatalf("closed/stale registration was admitted: %v", err)
				}
				_ = peer.SetReadDeadline(time.Now().Add(time.Second))
				var data [1]byte
				if _, err := peer.Read(data[:]); err != io.EOF {
					t.Fatalf("rejected connection was not closed: %v", err)
				}
			}
			probe(oldEpoch, false)
			// Even a freshly captured token cannot bypass the closed gate.
			probe(manager.RegistrationEpoch(), false)
			listener.err = nil
			var fds [2]int
			if err := syscall.Pipe(fds[:]); err != nil {
				t.Fatal(err)
			}
			defer syscall.Close(fds[1])
			if !startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
				return os.NewFile(uintptr(options.FileDescriptor), "late-connection-listener"), nil
			}) {
				_ = syscall.Close(fds[0])
				t.Fatal("synthetic restart rejected")
			}
			probe(oldEpoch, false)
			probe(manager.RegistrationEpoch(), true)
			epoch := manager.RegistrationEpoch()
			suspend(1)
			suspend(0)
			if manager.RegistrationEpoch() != epoch {
				t.Fatal("pause/resume changed the attachment generation")
			}
			if err := stopTunError(); err != nil {
				t.Fatal(err)
			}
			probe(epoch, false)
		})
	}
}

func TestAndroidBridgeRetriesLateRejectedConnectionClose(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	manager := statistic.DefaultManager
	manager.StartRegistrations()
	epoch := manager.RegistrationEpoch()
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	local, peer := net.Pipe()
	defer local.Close()
	defer peer.Close()
	failure := errors.New("late result close failed")
	direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "late-retry-test"})
	conn := &bridgeRetryConn{Conn: outbound.NewConn(local, direct), err: errors.Join(net.ErrClosed, failure)}
	t.Cleanup(func() { conn.err = nil; _ = stopTunError() })
	tracker, err := statistic.NewTCPTrackerAtEpoch(conn, manager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true, epoch)
	if tracker != nil || !errors.Is(err, failure) || conn.closes != 1 {
		t.Fatalf("late rejection lost close failure: %v (closes=%d)", err, conn.closes)
	}
	// The initial stop already returned; this error belongs to late cleanup and
	// must remain reachable by the next stop rather than disappear from ownership.
	if err := stopTunError(); !errors.Is(err, failure) || conn.closes != 2 {
		t.Fatalf("late failure not retried: %v (closes=%d)", err, conn.closes)
	}
	conn.err = nil
	if err := stopTunError(); err != nil || conn.closes != 3 {
		t.Fatalf("late cleanup retry failed: %v (closes=%d)", err, conn.closes)
	}
	if err := stopTunError(); err != nil || conn.closes != 3 {
		t.Fatalf("released late result closed again: %v (closes=%d)", err, conn.closes)
	}
}

// BeginSetup models the interval between an accepted socket and its tracker
// registration.  Stop cancels the registration generation, but must retain the
// setup debt until its owner releases it.
func TestAndroidBridgeSetupCancellationWaitsForRelease(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	manager := statistic.DefaultManager
	manager.StopRegistrations()
	manager.StartRegistrations()
	epoch, registrationCtx := manager.Registration()
	release, err := manager.BeginSetup(epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	stopDone := make(chan error, 1)
	go func() { stopDone <- stopTunError() }()
	select {
	case <-registrationCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("stop did not cancel the registration generation")
	}
	select {
	case err := <-stopDone:
		t.Fatalf("stop returned before setup release: %v", err)
	default:
	}
	release()
	select {
	case err := <-stopDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("stop did not finish after setup release")
	}
}

func TestAndroidBridgeUncooperativeSetupBlocksReplacementAndPreservesFD(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	manager := statistic.DefaultManager
	manager.StopRegistrations()
	manager.StartRegistrations()
	epoch, _ := manager.Registration()
	release, err := manager.BeginSetup(epoch)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	var fds [2]int
	if err := syscall.Pipe(fds[:]); err != nil {
		t.Fatal(err)
	}
	defer syscall.Close(fds[0])
	defer syscall.Close(fds[1])
	constructCalls := 0
	stopErr := make(chan error, 1)
	go func() { stopErr <- stopTunError() }()
	var firstStopErr error
	select {
	case firstStopErr = <-stopErr:
		if !errors.Is(firstStopErr, context.DeadlineExceeded) {
			t.Fatalf("uncooperative setup stop unexpectedly succeeded or lost deadline: %v", firstStopErr)
		}
	case <-time.After(androidSetupDrainTimeout + 500*time.Millisecond):
		t.Fatal("uncooperative setup did not reach the deadline")
	}
	if startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		constructCalls++
		return os.NewFile(uintptr(options.FileDescriptor), "must-not-start"), nil
	}) {
		t.Fatal("replacement started over setup debt")
	}
	if constructCalls != 0 {
		t.Fatal("failed replacement called the constructor")
	}
	var stat syscall.Stat_t
	if err := syscall.Fstat(fds[0], &stat); err != nil {
		t.Fatalf("failed replacement consumed caller fd: %v", err)
	}
	release()
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	fresh := &bridgeConstructedListener{fd: -1}
	if !startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		fresh.fd = options.FileDescriptor
		return fresh, nil
	}) {
		t.Fatal("fresh constructor did not start after setup debt was released")
	}
	if err := syscall.Fstat(fds[0], &stat); !errors.Is(err, syscall.EBADF) {
		t.Fatalf("fresh start did not consume caller fd: %v", err)
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

func TestAndroidBridgeEarlyTCPSetupCloseUnblocksStop(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	manager := statistic.DefaultManager
	manager.StopRegistrations()
	manager.StartRegistrations()
	epoch, _ := manager.Registration()
	release, err := manager.BeginSetup(epoch)
	if err != nil {
		t.Fatal(err)
	}
	local, peer := net.Pipe()
	defer peer.Close()
	direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "early-setup-close"})
	closed := make(chan struct{})
	signalConn := &bridgeSetupSignalConn{Conn: local, closed: closed}
	tracker := statistic.NewTCPTracker(outbound.NewConn(signalConn, direct), manager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true)
	defer tracker.Close()
	go func() {
		<-closed
		release()
	}()
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if manager.Get(tracker.ID()) != nil {
		t.Fatal("early TCP tracker remained registered after stop")
	}
}

func TestAndroidBridgeLateRejectedTrackerIsRetriedAfterSnapshot(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	manager := statistic.DefaultManager
	manager.StopRegistrations()
	manager.StartRegistrations()
	epoch, _ := manager.Registration()
	release, err := manager.BeginSetup(epoch)
	if err != nil {
		t.Fatal(err)
	}
	local, peer := net.Pipe()
	defer peer.Close()
	failure := errors.New("late setup close failed")
	direct := outbound.NewDirectWithOption(outbound.DirectOption{Name: "late-setup"})
	conn := &bridgeRetryConn{Conn: outbound.NewConn(local, direct), err: errors.Join(net.ErrClosed, failure)}
	barrierLocal, barrierPeer := net.Pipe()
	defer barrierPeer.Close()
	snapshotClosed := make(chan struct{})
	barrier := statistic.NewTCPTracker(outbound.NewConn(&bridgeSetupSignalConn{Conn: barrierLocal, closed: snapshotClosed}, direct), manager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true)
	defer barrier.Close()
	stopDone := make(chan error, 1)
	go func() { stopDone <- stopTunError() }()
	select {
	case <-snapshotClosed:
	case <-time.After(time.Second):
		t.Fatal("snapshot barrier was not closed")
	}
	tracker, err := statistic.NewTCPTrackerAtEpoch(conn, manager, &constant.Metadata{NetWork: constant.TCP}, nil, 0, 0, true, epoch)
	if tracker != nil || !errors.Is(err, failure) {
		t.Fatalf("late rejected tracker result: tracker=%v err=%v", tracker, err)
	}
	release()
	if err := <-stopDone; !errors.Is(err, errAndroidLateSetupConnections) {
		t.Fatalf("late tracker was not reported after snapshot: %v", err)
	}
	conn.err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	remaining := 0
	manager.Range(func(statistic.Tracker) bool { remaining++; return true })
	if remaining != 0 || conn.closes != 2 {
		t.Fatalf("late tracker retry did not release ownership: closes=%d", conn.closes)
	}
}

type bridgeSetupSignalConn struct {
	net.Conn
	closed chan struct{}
	once   sync.Once
}

func (c *bridgeSetupSignalConn) Close() error {
	err := c.Conn.Close()
	c.once.Do(func() { close(c.closed) })
	return err
}

// Provider cancellation is tested through the real stop body, separately from
// attachment cleanup. A fake wait barrier models context-agnostic parser debt.
type bridgeProviderResource struct {
	closed   chan struct{}
	drained  chan struct{}
	once     sync.Once
	closeErr error
	closes   int
	waits    int
}

func (p *bridgeProviderResource) Close() error {
	p.closes++
	p.once.Do(func() { close(p.closed) })
	return p.closeErr
}
func (p *bridgeProviderResource) WaitClosed(ctx context.Context) error {
	p.waits++
	select {
	case <-p.drained:
		return nil
	default:
	}
	select {
	case <-p.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestAndroidBridgeProviderStopCancelsEveryGenerationAndJoins(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	defer func() { _ = stopTunError() }()
	first := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	second := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	androidRuntime.ownProvider("old/proxy", first)
	androidRuntime.ownProvider("new/rule", second)
	// Stop must cancel both BEFORE waiting on either, independent of map order.
	done := make(chan error, 1)
	go func() { done <- stopTunError() }()
	for _, p := range []*bridgeProviderResource{first, second} {
		select {
		case <-p.closed:
		case <-time.After(5 * time.Second):
			close(first.drained)
			close(second.drained)
			t.Fatal("stop waited before cancelling every provider")
		}
	}
	select {
	case err := <-done:
		t.Fatalf("stop returned before provider drain: %v", err)
	default:
	}
	close(first.drained)
	close(second.drained)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.providers) != 0 || !androidRuntime.providersStopped {
		t.Fatal("stop did not release provider ownership and invalidate configuration")
	}
	if first.closes != 1 || second.closes != 1 || first.waits != 1 || second.waits != 1 {
		t.Fatal("provider close/drain was not exactly once")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if first.closes != 1 || second.closes != 1 {
		t.Fatal("successful stop retained released providers")
	}
}

func TestAndroidBridgeProviderStopFailureStillCleansListenerAndRetries(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	p := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{}), closeErr: errors.New("watcher close failure")}
	close(p.drained)
	androidRuntime.ownProvider("failing", p)
	listener := &bridgeTestListener{}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	defer func() { p.closeErr = nil; _ = stopTunError() }()
	if err := stopTunError(); !errors.Is(err, p.closeErr) {
		t.Fatalf("stop error = %v", err)
	}
	if listener.closes != 1 || androidRuntime.listener != nil || androidRuntime.ready() {
		t.Fatal("provider failure skipped listener cleanup or restored admission")
	}
	if len(androidRuntime.providers) != 1 {
		t.Fatal("failed provider lost retry ownership")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); !errors.Is(err, errAndroidProviderCleanupPending) {
		t.Fatalf("configuration bypassed pending provider cleanup: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidProviderCleanupPending) {
		t.Fatalf("DNS reparse bypassed pending provider cleanup: %v", err)
	}
	p.closeErr = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.providers) != 0 || p.closes != 2 {
		t.Fatal("provider retry failed")
	}
}

func TestAndroidBridgeProviderDrainTimeoutRetainsOnlyDebt(t *testing.T) {
	var lifecycle androidTunLifecycle
	stuck := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	done := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	close(done.drained)
	lifecycle.ownProvider("stuck", stuck)
	lifecycle.ownProvider("done", done)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := lifecycle.closeProviders(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("drain = %v", err)
	}
	if len(lifecycle.providers) != 1 || lifecycle.providers[stuck] != "stuck" {
		t.Fatal("timeout lost debt or retained completed resource")
	}
	close(stuck.drained)
	if err := lifecycle.closeProviders(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(lifecycle.providers) != 0 || stuck.closes != 2 || done.closes != 1 {
		t.Fatal("drain retry ownership incorrect")
	}
}

func TestAndroidBridgeProviderAttachmentCleanupDoesNotCancelConfig(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	p := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	close(p.drained)
	androidRuntime.ownProvider("newly-applied", p)
	defer func() { _ = stopTunError() }()
	if err := closeAndroidResources(); err != nil {
		t.Fatal(err)
	}
	if p.closes != 0 || androidRuntime.providersStopped || len(androidRuntime.providers) != 1 {
		t.Fatal("attachment cleanup cancelled newly applied providers")
	}
}

func TestAndroidBridgeProviderStopRequiresFreshApplyBeforeAttach(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.providers) == 0 {
		t.Fatal("apply did not capture concrete provider ownership")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if !androidRuntime.providersStopped {
		t.Fatal("stop did not invalidate closed providers")
	}
	file, err := os.CreateTemp(t.TempDir(), "caller-fd")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	constructed := false
	construct := func(options LC.Tun) (io.Closer, error) {
		constructed = true
		_ = syscall.Close(options.FileDescriptor)
		return &bridgeTestListener{}, nil
	}
	if startAndroidTUNWithConstructor(int(file.Fd()), "system", "10.0.0.1/30", "", androidRuntime.stopGeneration.Load(), construct) || constructed {
		t.Fatal("start reused providers closed by stop")
	}
	if _, err := file.Stat(); err != nil {
		t.Fatalf("rejected start consumed caller fd: %v", err)
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	if androidRuntime.providersStopped {
		t.Fatal("fresh apply did not restore provider configuration")
	}
	if !startAndroidTUNWithConstructor(int(file.Fd()), "system", "10.0.0.1/30", "", androidRuntime.stopGeneration.Load(), construct) || !constructed {
		t.Fatal("fresh configuration could not attach")
	}
}

func TestAndroidBridgeProviderActualFileFetchersOwnedAcrossReload(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	home := t.TempDir()
	if err := initializeAndroid(home); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	if err := os.WriteFile(home+"/proxy.yaml", []byte("proxies: [{name: local, type: direct}]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(home+"/rule.yaml", []byte("payload: [example.com]\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("direct"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["proxy-providers"] = map[string]any{"local": map[string]any{"type": "file", "path": home + "/proxy.yaml", "health-check": map[string]any{"enable": false}}}
	cfg["rule-providers"] = map[string]any{"local": map[string]any{"type": "file", "path": home + "/rule.yaml", "behavior": "domain", "format": "yaml"}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(data); err != nil {
		t.Fatal(err)
	}
	proxy := tunnel.Providers()["local"]
	rule := tunnel.RuleProviders()["local"]
	for _, provider := range []any{proxy, rule} {
		if _, ok := provider.(androidProviderWaiter); !ok {
			t.Fatal("concrete provider does not expose Fetcher drain")
		}
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	for _, provider := range []interface{ Update() error }{proxy, rule} {
		if err := provider.Update(); !errors.Is(err, context.Canceled) {
			t.Fatalf("retired provider Update after stop = %v", err)
		}
	}
	if len(androidRuntime.providers) != 0 {
		t.Fatal("stop retained drained providers")
	}
}

func TestAndroidBridgeProviderActualStopTimeoutBlocksReapplyAndAttach(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	p := &bridgeProviderResource{closed: make(chan struct{}), drained: make(chan struct{})}
	androidRuntime.ownProvider("blocked-parser", p)
	listener := &bridgeTestListener{}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	defer func() { close(p.drained); _ = stopTunError() }()
	if err := stopTunError(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stop did not report bounded provider drain failure: %v", err)
	}
	if len(androidRuntime.providers) != 1 || listener.closes != 1 || androidRuntime.ready() {
		t.Fatal("timeout lost provider ownership or skipped listener cleanup")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); !errors.Is(err, errAndroidProviderCleanupPending) {
		t.Fatalf("new apply bypassed timed-out provider cleanup: %v", err)
	}
	constructed := false
	if startAndroidTUNWithConstructor(-1, "system", "10.0.0.1/30", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) {
		constructed = true
		return nil, errors.New("must not construct")
	}) || constructed {
		t.Fatal("attachment bypassed timed-out provider cleanup")
	}
}
