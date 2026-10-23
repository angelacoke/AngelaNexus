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
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/listener"
	LC "github.com/metacubex/mihomo/listener/config"
	namedinbound "github.com/metacubex/mihomo/listener/inbound"
	"github.com/metacubex/mihomo/tunnel"
)

func bridgeNamedConfig(t *testing.T, addr string) []byte {
	t.Helper()
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	p, err := strconv.Atoi(port)
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["mixed-port"] = 0
	// An explicit empty user list uses the named auth store, not mutable
	// default/global auth and IP-filter settings updated later during ApplyConfig.
	cfg["listeners"] = []any{map[string]any{"name": "android-named-mixed", "type": "mixed", "listen": host, "port": p, "udp": false, "users": []any{}}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// Real config.Parse -> executor.ApplyConfig -> PatchInboundListeners, followed
// by the production explicit stop. No default mixed-port listener is created.
func TestAndroidBridgeNamedInboundStopRebuildSameConfig(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		// Also clean the deliberately missing-stop negative: no leaked peer may
		// overlap a later mutation of auth/filter globals.
		listener.PatchInboundListeners(map[string]C.InboundListener{}, tunnel.Tunnel, true)
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	addr := bridgeDNSAddress(t)
	data := bridgeNamedConfig(t, addr)
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(data); err != nil {
			t.Fatal(err)
		}
		idle := bridgeMixedPeer(t, addr)
		peer := bridgeMixedPeer(t, addr)
		_ = peer.SetDeadline(time.Now().Add(time.Second))
		if _, err := peer.Write([]byte{5, 1, 0}); err != nil {
			t.Fatal(err)
		}
		var reply [2]byte
		if _, err := io.ReadFull(peer, reply[:]); err != nil || reply != [2]byte{5, 0} {
			t.Fatalf("named mixed handshake not admitted at generation %d: %v %v", generation, reply, err)
		}
		_ = peer.SetDeadline(time.Time{})
		// Attachment replacement must leave newly applied named listeners alive.
		if err := closeAndroidResources(); err != nil {
			t.Fatal(err)
		}
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		for _, c := range []net.Conn{peer, idle} {
			_ = c.SetReadDeadline(time.Now().Add(time.Second))
			var b [1]byte
			if _, err := c.Read(b[:]); err != io.EOF {
				t.Fatalf("named inbound peer survived explicit stop: %v", err)
			}
		}
		if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			_ = c.Close()
			t.Fatal("named inbound socket still accepts after stop")
		}
		bound, err := net.Listen("tcp", addr)
		if err != nil {
			t.Fatalf("named inbound port still owned after stop: %v", err)
		}
		_ = bound.Close()
	}
}

func bridgeNamedInjected(t *testing.T, l net.Listener) *namedinbound.Mixed {
	t.Helper()
	m, err := namedinbound.NewMixed(&namedinbound.MixedOption{
		BaseOption: namedinbound.BaseOption{NameStr: "named-injected", Listen: "127.0.0.1", Port: "0", ListenConfigForAPI: bridgeMixedListenConfig{listener: l}},
		Users:      namedinbound.AuthUsers{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Listen(tunnel.Tunnel); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestAndroidBridgeNamedInboundFailureRetainsIndependentDebt(t *testing.T) {
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
	bridgeNamedInjected(t, l)
	defer func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	peer := bridgeMixedPeer(t, base.Addr().String())
	select {
	case <-l.read:
	case <-time.After(time.Second):
		t.Fatal("named first-byte reader not reached")
	}
	stale := androidRuntime.stopGeneration.Load()
	if err := stopTunError(); err == nil {
		t.Fatal("explicit stop forgot named close failure")
	}
	bridgeMixedEOF(t, peer)
	if !androidRuntime.namedCleanupPending || androidRuntime.mixedCleanupPending || androidRuntime.resourceCleanupPending || androidRuntime.dnsCleanupPending || androidRuntime.ntpCleanupPending {
		t.Fatal("successful components overwrote independent named cleanup debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("fresh apply bypassed named cleanup debt: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("fresh DNS bypassed named cleanup debt: %v", err)
	}
	androidRuntime.providersStopped = false
	androidRuntime.resolversStopped = false
	f, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	constructed := false
	if startAndroidTUNWithConstructor(int(f.Fd()), "system", "10.0.0.1/24", "", androidRuntime.stopGeneration.Load(), func(_ LC.Tun) (io.Closer, error) { constructed = true; return nil, errors.New("must not construct") }) || constructed {
		t.Fatal("attachment bypassed named cleanup debt")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("named stop retry failed: %v", err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("successful named retry retained debt")
	}
	if err := applyAndroidConfigJSONAtGeneration(bridgeMixedConfig(t, 0), stale); err == nil {
		t.Fatal("stale named generation applied after successful retry")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("fresh apply blocked after named retry: %v", err)
	}
}

type bridgeNamedBlockedListener struct {
	net.Listener
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (l *bridgeNamedBlockedListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &bridgeNamedBlockedConn{Conn: c, l: l}, nil
}

type bridgeNamedBlockedConn struct {
	net.Conn
	l *bridgeNamedBlockedListener
}

func (c *bridgeNamedBlockedConn) Read(p []byte) (int, error) {
	c.l.once.Do(func() { close(c.l.entered) })
	<-c.l.release
	return c.Conn.Read(p)
}

func TestAndroidBridgeNamedInboundWaitsForHandlerAndRetries(t *testing.T) {
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
	l := &bridgeNamedBlockedListener{Listener: base, entered: make(chan struct{}), release: make(chan struct{})}
	bridgeNamedInjected(t, l)
	released := false
	defer func() {
		if !released {
			close(l.release)
		}
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	peer := bridgeMixedPeer(t, base.Addr().String())
	select {
	case <-l.entered:
	case <-time.After(time.Second):
		t.Fatal("blocked named handler not entered")
	}
	// Same production stop helper, short shared deadline; no synthetic waiter.
	androidTunMu.Lock()
	err = stopAndroidNamed(10 * time.Millisecond)
	androidTunMu.Unlock()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("named stop did not await blocked handler: %v", err)
	}
	if !androidRuntime.namedCleanupPending {
		t.Fatal("named handler timeout lost cleanup debt")
	}
	bridgeMixedEOF(t, peer)
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("timed-out named handler allowed replacement: %v", err)
	}
	close(l.release)
	released = true
	if err := stopTunError(); err != nil {
		t.Fatalf("named handler retry did not drain: %v", err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("joined named handler retained debt")
	}
}
