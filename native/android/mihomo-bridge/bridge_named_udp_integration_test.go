package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/metacubex/mihomo/component/dialer"
	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	namedinbound "github.com/metacubex/mihomo/listener/inbound"
	"github.com/metacubex/mihomo/listener/socks"
	"github.com/metacubex/mihomo/transport/socks5"
	"github.com/metacubex/mihomo/tunnel"
)

// Keep TCP and UDP concrete sockets under the same named Mixed generation.
type bridgeNamedUDPConfig struct {
	C.InboundListenConfig
	tcp net.Listener
	pc  net.PacketConn
}

func (c bridgeNamedUDPConfig) Listen(context.Context, string, string) (net.Listener, error) {
	return c.tcp, nil
}
func (c bridgeNamedUDPConfig) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	return c.pc, nil
}
func bridgeNamedUDPInjected(t *testing.T, pc net.PacketConn, tunnel C.Tunnel) *namedinbound.Mixed {
	t.Helper()
	tcp, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	m, err := namedinbound.NewMixed(&namedinbound.MixedOption{
		BaseOption: namedinbound.BaseOption{NameStr: "named-udp-injected", Listen: "127.0.0.1", Port: "0", ListenConfigForAPI: bridgeNamedUDPConfig{tcp: tcp, pc: pc}},
		UDP:        true, Users: namedinbound.AuthUsers{},
	})
	if err != nil {
		tcp.Close()
		t.Fatal(err)
	}
	if err = m.Listen(tunnel); err != nil {
		tcp.Close()
		pc.Close()
		t.Fatal(err)
	}
	return m
}
func bridgeNamedUDPConfigJSON(t *testing.T, addr string) []byte {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal(bridgeNamedConfig(t, addr), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["listeners"].([]any)[0].(map[string]any)["udp"] = true
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func TestAndroidBridgeNamedInboundUDPPacketTimeoutRequiresRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h := bridgeMixedUDPHoldingTunnel{packets: make(chan C.UDPPacket, 1)}
	bridgeNamedUDPInjected(t, pc, h)
	peer, err := net.Dial("udp", pc.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	// SOCKS5 UDP header: loopback IPv4 destination 127.0.0.1:9, payload 42.
	if _, err := peer.Write([]byte{0, 0, 0, 1, 127, 0, 0, 1, 0, 9, 42}); err != nil {
		t.Fatal(err)
	}
	var packet C.UDPPacket
	select {
	case packet = <-h.packets:
	case <-time.After(time.Second):
		t.Fatal("real named UDP handler did not admit packet")
	}
	defer func() { packet.Drop(); _ = stopTunError() }()
	if err := stopAndroidNamed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("held named UDP packet was not a stop timeout: %v", err)
	}
	if !androidRuntime.namedCleanupPending {
		t.Fatal("packet drain timeout forgot named UDP debt")
	}
	if err := stopAndroidNamed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("named UDP retry forgot still-held generation: %v", err)
	}
	if got := packet.Data(); len(got) != 1 || got[0] != 42 {
		t.Fatalf("stop reclaimed live packet payload before Drop: %v", got)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("apply bypassed held named UDP packet debt: %v", err)
	}
	if _, err := packet.WriteBack([]byte{1}, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 9}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("retired UDP packet write-back was not closed: %v", err)
	}
	packet.Drop()
	packet.Drop() // Ownership acknowledgement is idempotent, including deferred cleanup.
	if err := stopTunError(); err != nil {
		t.Fatalf("packet Drop did not allow actual stop retry: %v", err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("packet retry retained debt after actual Drop")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("apply blocked after packet drain retry: %v", err)
	}
}

func TestAndroidBridgeNamedInboundUDPWriteBackTimeoutRequiresRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &bridgeMixedUDPBlockedWrite{PacketConn: pc, entered: make(chan struct{}), release: make(chan struct{})}
	h := bridgeMixedUDPHoldingTunnel{packets: make(chan C.UDPPacket, 1)}
	bridgeNamedUDPInjected(t, f, h)
	peer, err := net.Dial("udp", pc.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err := peer.Write([]byte{0, 0, 0, 1, 127, 0, 0, 1, 0, 9, 42}); err != nil {
		t.Fatal(err)
	}
	var packet C.UDPPacket
	select {
	case packet = <-h.packets:
	case <-time.After(time.Second):
		t.Fatal("write-back test packet was not admitted")
	}
	packet.Drop()
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(f.release) }) }
	writeDone := make(chan struct{})
	var writeErr error
	go func() {
		_, writeErr = packet.WriteBack([]byte{1}, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 9})
		close(writeDone)
	}()
	defer func() {
		release()
		select {
		case <-writeDone:
		case <-time.After(time.Second):
			t.Error("write-back did not return during cleanup")
		}
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	select {
	case <-f.entered:
	case <-time.After(time.Second):
		t.Fatal("write-back did not enter socket WriteTo")
	}
	if err := stopAndroidNamed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("admitted named UDP write-back was not a stop timeout: %v", err)
	}
	if !androidRuntime.namedCleanupPending {
		t.Fatal("write-back timeout forgot named UDP debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("apply bypassed named UDP write-back debt: %v", err)
	}
	release()
	select {
	case <-writeDone:
	case <-time.After(time.Second):
		t.Fatal("write-back did not exit after release")
	}
	if !errors.Is(writeErr, net.ErrClosed) {
		t.Fatalf("retired concrete UDP socket write-back: %v", writeErr)
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("write-back stop retry failed: %v", err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("write-back debt survived acknowledged method exit")
	}
}
func TestAndroidBridgeNamedInboundUDPRealTunnelRoundTripAcrossStop(t *testing.T) {
	// Host loopback has no Android JNI VpnService. Substitute only protect(fd),
	// retaining the production runtime's admission/epoch checks around it.
	oldHook := dialer.DefaultSocketHook
	dialer.DefaultSocketHook = func(_, _ string, conn syscall.RawConn) error {
		return androidRuntime.socketHook(conn, func(int) bool { return true })
	}
	defer func() { dialer.DefaultSocketHook = oldHook }()
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError(); _ = applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); _ = stopTunError() }()
	echo, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer echo.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		var b [2048]byte
		for {
			n, addr, err := echo.ReadFrom(b[:])
			if err != nil {
				return
			}
			_, _ = echo.WriteTo(b[:n], addr)
		}
	}()
	defer func() { _ = echo.Close(); <-done }()
	addr := bridgeDNSAddress(t)
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(bridgeNamedUDPConfigJSON(t, addr)); err != nil {
			t.Fatal(err)
		}
		var fds [2]int
		if err := syscall.Pipe(fds[:]); err != nil {
			t.Fatal(err)
		}
		accepted := startAndroidTUNWithConstructor(fds[0], "system", "172.19.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
			return os.NewFile(uintptr(options.FileDescriptor), "mixed-udp-test-attachment"), nil
		})
		_ = syscall.Close(fds[1])
		if !accepted {
			_ = syscall.Close(fds[0])
			t.Fatal("synthetic bridge attachment rejected")
		}
		peer, err := net.Dial("udp", addr)
		if err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 3; i++ {
			payload := []byte{42, byte(generation), byte(i)}
			wire, err := socks5.EncodeUDPPacket(socks5.ParseAddrToSocksAddr(echo.LocalAddr()), payload)
			if err != nil {
				_ = peer.Close()
				t.Fatal(err)
			}
			_ = peer.SetDeadline(time.Now().Add(time.Second))
			if _, err := peer.Write(wire); err != nil {
				_ = peer.Close()
				t.Fatal(err)
			}
			var buf [2048]byte
			n, err := peer.Read(buf[:])
			if err != nil {
				_ = peer.Close()
				t.Fatalf("real named UDP tunnel round-trip generation %d: %v", generation, err)
			}
			_, got, err := socks5.DecodeUDPPacket(buf[:n])
			if err != nil || !bytes.Equal(got, payload) {
				_ = peer.Close()
				t.Fatalf("real named UDP payload mismatch: %v %v", got, err)
			}
		}
		_ = peer.Close()
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		pc, err := net.ListenPacket("udp", addr)
		if err != nil {
			t.Fatalf("real named UDP traffic left socket owned after stop: %v", err)
		}
		_ = pc.Close()
	}
}

// A tunnel callback can Drop the packet but still be executing. Reader exit,
// not packet count or socket-close alone, acknowledges this synchronous worker.
type bridgeNamedUDPBlockedTunnel struct {
	C.Tunnel
	entered chan struct{}
	release chan struct{}
	exited  chan struct{}
}

func (h *bridgeNamedUDPBlockedTunnel) HandleUDPPacket(p C.UDPPacket, _ *C.Metadata) {
	p.Drop()
	close(h.entered)
	<-h.release
	close(h.exited)
}
func TestAndroidBridgeNamedInboundUDPHandlerTimeoutRequiresRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	h := &bridgeNamedUDPBlockedTunnel{entered: make(chan struct{}), release: make(chan struct{}), exited: make(chan struct{})}
	bridgeNamedUDPInjected(t, pc, h)
	peer, err := net.Dial("udp", pc.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	var once sync.Once
	release := func() { once.Do(func() { close(h.release) }) }
	defer func() {
		release()
		select {
		case <-h.exited:
		case <-time.After(time.Second):
			t.Error("named UDP handler did not exit")
		}
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	if _, err := peer.Write([]byte{0, 0, 0, 1, 127, 0, 0, 1, 0, 9, 42}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-h.entered:
	case <-time.After(time.Second):
		t.Fatal("named UDP callback did not enter")
	}
	// Default stop must not close or join this named generation.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := socks.StopMixedUDP(ctx); err != nil {
		t.Fatal(err)
	}
	if c, err := net.ListenPacket("udp", pc.LocalAddr().String()); err == nil {
		c.Close()
		t.Fatal("default UDP registry captured named generation")
	}
	if err := stopAndroidNamed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("named UDP handler exit was not a stop timeout: %v", err)
	}
	if !androidRuntime.namedCleanupPending || androidRuntime.mixedCleanupPending {
		t.Fatal("named UDP handler lost independent cleanup debt")
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("DNS bypassed named UDP handler debt: %v", err)
	}
	release()
	select {
	case <-h.exited:
	case <-time.After(time.Second):
		t.Fatal("named UDP handler release failed")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("named UDP handler retry retained debt")
	}
}

func TestAndroidBridgeNamedInboundUDPDefaultRegistryIsolation(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	bridgeNamedUDPInjected(t, pc, bridgeMixedUDPHoldingTunnel{packets: make(chan C.UDPPacket, 1)})
	defer func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := socks.StopMixedUDP(ctx); err != nil {
		t.Fatal(err)
	}
	if c, err := net.ListenPacket("udp", pc.LocalAddr().String()); err == nil {
		c.Close()
		t.Fatal("default UDP registry captured named generation")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	c, err := net.ListenPacket("udp", pc.LocalAddr().String())
	if err != nil {
		t.Fatalf("named UDP socket survived its own stop: %v", err)
	}
	c.Close()
}

func TestAndroidBridgeNamedInboundUDPStopFailureRetainsDebt(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatal(err)
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &bridgeMixedUDPFailure{PacketConn: pc}
	f.fail.Store(true)
	bridgeNamedUDPInjected(t, f, tunnel.Tunnel)
	defer func() { _ = stopTunError() }()
	if err := stopTunError(); err == nil {
		t.Fatal("explicit stop forgot named UDP close failure")
	}
	if !androidRuntime.namedCleanupPending || androidRuntime.resourceCleanupPending || androidRuntime.dnsCleanupPending || androidRuntime.ntpCleanupPending {
		t.Fatal("successful components overwrote named UDP cleanup debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("fresh apply bypassed failed named UDP stop cleanup: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidNamedCleanupPending) {
		t.Fatalf("fresh DNS update bypassed failed named UDP stop cleanup: %v", err)
	}
	androidRuntime.providersStopped, androidRuntime.resolversStopped = false, false
	file, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	constructed := false
	if startAndroidTUNWithConstructor(int(file.Fd()), "system", "10.0.0.1/24", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) { constructed = true; return nil, errors.New("must not construct") }) || constructed {
		t.Fatal("attachment bypassed named UDP stop retry gate")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("named UDP stop retry failed: %v", err)
	}
	if androidRuntime.namedCleanupPending {
		t.Fatal("successful named UDP stop retry retained debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("apply blocked after named UDP retry: %v", err)
	}
}
