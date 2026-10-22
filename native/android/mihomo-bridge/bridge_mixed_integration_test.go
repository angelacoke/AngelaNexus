package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/listener/mixed"
	"github.com/metacubex/mihomo/tunnel"
)

func bridgeMixedConfig(t *testing.T, port int) []byte {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["mixed-port"] = port
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func bridgeMixedPeer(t *testing.T, addr string) net.Conn {
	t.Helper()
	peer, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	return peer
}

func bridgeMixedEOF(t *testing.T, peer net.Conn) {
	t.Helper()
	_ = peer.SetReadDeadline(time.Now().Add(time.Second))
	var b [1]byte
	if _, err := peer.Read(b[:]); err != io.EOF {
		t.Fatalf("mixed pre-first-byte peer did not observe EOF after stop: %v", err)
	}
}

func TestAndroidBridgeMixedStopReleasesListenerAndRestartsSamePort(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		// Cleanup must also work with the deliberately missing-stop mutant.
		// Join ingress before apply mutates upstream auth/filter globals.
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := mixed.StopListeners(ctx); err != nil {
			t.Error(err)
		}
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
		// This bounded repair does not claim ownership of mixed UDP.
		if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
			t.Error(err)
		}
		_ = stopTunError()
	}()
	addr := bridgeDNSAddress(t)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(bridgeMixedConfig(t, port)); err != nil {
			t.Fatal(err)
		}
		// Accept order is FIFO on this loopback TCP listener. The later SOCKS
		// response proves this earlier idle peer has also left the backlog.
		idle := bridgeMixedPeer(t, addr)
		peer := bridgeMixedPeer(t, addr)
		// A complete SOCKS greeting confirms that the real handler, not just the
		// listen backlog, owns this peer; leave its request handshake incomplete.
		_ = peer.SetDeadline(time.Now().Add(time.Second))
		if _, err := peer.Write([]byte{5, 1, 0}); err != nil {
			t.Fatal(err)
		}
		var reply [2]byte
		if _, err := io.ReadFull(peer, reply[:]); err != nil || reply != [2]byte{5, 0} {
			t.Fatalf("mixed SOCKS handshake not admitted: %v %v", reply, err)
		}
		_ = peer.SetDeadline(time.Time{})
		// Attachment replacement must not destroy freshly applied mixed ingress.
		if err := closeAndroidResources(); err != nil {
			t.Fatal(err)
		}
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		bridgeMixedEOF(t, peer)
		bridgeMixedEOF(t, idle)
		if conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			_ = conn.Close()
			t.Fatal("mixed TCP listener still accepts after explicit stop")
		}
		bound, err := net.Listen("tcp", addr)
		if err != nil {
			t.Fatalf("mixed TCP port still owned after explicit stop: %v", err)
		}
		_ = bound.Close()
	}
}

type bridgeMixedListenConfig struct {
	C.InboundListenConfig
	listener net.Listener
}

func (c bridgeMixedListenConfig) Listen(context.Context, string, string) (net.Listener, error) {
	return c.listener, nil
}

type bridgeMixedFailureListener struct {
	net.Listener
	fail atomic.Bool
	read chan struct{}
	once sync.Once
}

func (l *bridgeMixedFailureListener) Close() error {
	err := l.Listener.Close()
	if l.fail.Swap(false) {
		return errors.New("mixed injected listener acknowledgement failure")
	}
	return err
}

func (l *bridgeMixedFailureListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &bridgeMixedReadConn{Conn: c, entered: func() { l.once.Do(func() { close(l.read) }) }}, nil
}

type bridgeMixedReadConn struct {
	net.Conn
	entered func()
}

func (c *bridgeMixedReadConn) Read(p []byte) (int, error) {
	c.entered()
	return c.Conn.Read(p)
}

func TestAndroidBridgeMixedStopFailureRetainsIndependentDebt(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	base, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	l := &bridgeMixedFailureListener{Listener: base, read: make(chan struct{})}
	l.fail.Store(true)
	if _, err := mixed.NewWithConfig(LC.AuthServer{Enable: true, Listen: base.Addr().String()}, bridgeMixedListenConfig{listener: l}, tunnel.Tunnel); err != nil {
		_ = base.Close()
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	peer := bridgeMixedPeer(t, base.Addr().String())
	select {
	case <-l.read:
	case <-time.After(time.Second):
		t.Fatal("mixed first-byte reader was never reached")
	}
	if err := stopTunError(); err == nil {
		t.Fatal("explicit stop forgot mixed close failure")
	}
	bridgeMixedEOF(t, peer)
	if !androidRuntime.mixedCleanupPending || androidRuntime.resourceCleanupPending || androidRuntime.dnsCleanupPending || androidRuntime.ntpCleanupPending {
		t.Fatal("successful components overwrote independent mixed cleanup debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("fresh apply bypassed failed mixed stop cleanup: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("fresh DNS update bypassed failed mixed stop cleanup: %v", err)
	}
	// Isolate this gate from irreversible provider/resolver attachment guards.
	androidRuntime.providersStopped = false
	androidRuntime.resolversStopped = false
	file, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	constructed := false
	if startAndroidTUNWithConstructor(int(file.Fd()), "system", "10.0.0.1/24", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) {
		constructed = true
		return nil, errors.New("must not construct")
	}) || constructed {
		t.Fatal("attachment bypassed mixed stop retry gate")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("mixed stop retry failed: %v", err)
	}
	if androidRuntime.mixedCleanupPending {
		t.Fatal("successful mixed stop retry retained debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("apply remained blocked after successful mixed retry: %v", err)
	}
}
