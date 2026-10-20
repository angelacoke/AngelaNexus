package main

import (
	"errors"
	"io"
	"net"
	"syscall"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter/outbound"
	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/tunnel"
	"github.com/metacubex/mihomo/tunnel/statistic"
)

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
	defer tracker.Close()
	listenerFailure := errors.New("listener close failed")
	listener := &bridgeTestListener{err: listenerFailure}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	err := stopTunError()
	if !errors.Is(err, closeFailure) || !errors.Is(err, listenerFailure) {
		t.Fatalf("stop failed to report both cleanup errors: %v", err)
	}
	// Pinned upstream unregisters first, even when its underlying Close fails.
	if statistic.DefaultManager.Get(tracker.ID()) != nil || androidRuntime.pendingConnections[tracker.ID()] != tracker || conn.closes != 1 {
		t.Fatal("unregistered failed tracker lost retry ownership")
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
