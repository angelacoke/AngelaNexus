package main

import (
	"bytes"
	"context"
	"errors"
	"github.com/metacubex/mihomo/component/dialer"
	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/listener/socks"
	"github.com/metacubex/mihomo/transport/socks5"
	"github.com/metacubex/mihomo/tunnel"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"net"
	"strconv"
	"testing"
)

// Exercise the production apply/stop path, not a standalone substitute listener.
func TestAndroidBridgeMixedUDPStopReleasesPortAndRestarts(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = stopTunError()
		// Also release baseline/missing-UDP-stop mutants via ordinary reload.
		_ = applyAndroidConfigJSON(bridgeMixedConfig(t, 0))
		_ = stopTunError()
	}()
	addr := bridgeDNSAddress(t)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(bridgeMixedConfig(t, port)); err != nil {
			t.Fatal(err)
		}
		// A second non-reuse socket cannot bind while the real mixed UDP ingress lives.
		if c, err := net.ListenPacket("udp", addr); err == nil {
			_ = c.Close()
			t.Fatal("mixed UDP ingress did not bind before stop")
		}
		if err := closeAndroidResources(); err != nil {
			t.Fatal(err)
		}
		if c, err := net.ListenPacket("udp", addr); err == nil {
			_ = c.Close()
			t.Fatal("attachment cleanup destroyed freshly applied mixed UDP ingress")
		}
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		c, err := net.ListenPacket("udp", addr)
		if err != nil {
			t.Fatalf("mixed UDP port still owned after explicit stop: %v", err)
		}
		_ = c.Close()
	}
}

// Inject a concrete UDP socket whose first Close releases the fd but refuses
// its acknowledgement. Reader exit alone must not erase the retry obligation.
type bridgeMixedUDPConfig struct {
	C.InboundListenConfig
	pc net.PacketConn
}

func (c bridgeMixedUDPConfig) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	return c.pc, nil
}

type bridgeMixedUDPFailure struct {
	net.PacketConn
	fail atomic.Bool
}

func (c *bridgeMixedUDPFailure) Close() error {
	err := c.PacketConn.Close()
	if c.fail.Swap(false) {
		return errors.New("mixed UDP injected close acknowledgement failure")
	}
	return err
}
func TestAndroidBridgeMixedUDPStopFailureRetainsDebt(t *testing.T) {
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
	if _, err := socks.NewMixedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, bridgeMixedUDPConfig{pc: f}, tunnel.Tunnel); err != nil {
		_ = pc.Close()
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	if err := stopTunError(); err == nil {
		t.Fatal("explicit stop forgot mixed UDP close failure")
	}
	if !androidRuntime.mixedCleanupPending || androidRuntime.resourceCleanupPending || androidRuntime.dnsCleanupPending || androidRuntime.ntpCleanupPending {
		t.Fatal("successful components overwrote mixed UDP cleanup debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("fresh apply bypassed failed mixed UDP stop cleanup: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("fresh DNS update bypassed failed mixed UDP stop cleanup: %v", err)
	}
	androidRuntime.providersStopped, androidRuntime.resolversStopped = false, false
	file, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	constructed := false
	if startAndroidTUNWithConstructor(int(file.Fd()), "system", "10.0.0.1/24", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) { constructed = true; return nil, errors.New("must not construct") }) || constructed {
		t.Fatal("attachment bypassed mixed UDP stop retry gate")
	}
	if err := stopTunError(); err != nil {
		t.Fatalf("mixed UDP stop retry failed: %v", err)
	}
	if androidRuntime.mixedCleanupPending {
		t.Fatal("successful mixed UDP stop retry retained debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("apply blocked after mixed UDP retry: %v", err)
	}
}

type bridgeMixedUDPHoldingTunnel struct {
	C.Tunnel
	packets chan C.UDPPacket
}

func (t bridgeMixedUDPHoldingTunnel) HandleUDPPacket(p C.UDPPacket, _ *C.Metadata) { t.packets <- p }
func TestAndroidBridgeMixedUDPPacketTimeoutRequiresRetry(t *testing.T) {
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
	if _, err := socks.NewMixedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, bridgeMixedUDPConfig{pc: pc}, h); err != nil {
		_ = pc.Close()
		t.Fatal(err)
	}
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
		t.Fatal("real mixed UDP handler did not admit packet")
	}
	defer func() { packet.Drop(); _ = stopTunError() }()
	if err := stopAndroidMixed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("held mixed UDP packet was not a stop timeout: %v", err)
	}
	if !androidRuntime.mixedCleanupPending {
		t.Fatal("packet drain timeout forgot mixed UDP debt")
	}
	if got := packet.Data(); len(got) != 1 || got[0] != 42 {
		t.Fatalf("stop reclaimed live packet payload before Drop: %v", got)
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("apply bypassed held mixed UDP packet debt: %v", err)
	}
	if _, err := packet.WriteBack([]byte{1}, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 9}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("retired UDP packet write-back was not closed: %v", err)
	}
	packet.Drop()
	packet.Drop() // Ownership acknowledgement is idempotent, including deferred cleanup.
	if err := stopTunError(); err != nil {
		t.Fatalf("packet Drop did not allow actual stop retry: %v", err)
	}
	if androidRuntime.mixedCleanupPending {
		t.Fatal("packet retry retained debt after actual Drop")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); err != nil {
		t.Fatalf("apply blocked after packet drain retry: %v", err)
	}
}

func TestAndroidBridgeMixedUDPRealTunnelRoundTripAcrossStop(t *testing.T) {
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
	_, rawPort, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(rawPort)
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(bridgeMixedConfig(t, port)); err != nil {
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
				t.Fatalf("real mixed UDP tunnel round-trip generation %d: %v", generation, err)
			}
			_, got, err := socks5.DecodeUDPPacket(buf[:n])
			if err != nil || !bytes.Equal(got, payload) {
				_ = peer.Close()
				t.Fatalf("real mixed UDP payload mismatch: %v %v", got, err)
			}
		}
		_ = peer.Close()
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		pc, err := net.ListenPacket("udp", addr)
		if err != nil {
			t.Fatalf("real mixed UDP traffic left socket owned after stop: %v", err)
		}
		_ = pc.Close()
	}
}

// A relay may retain the packet as a WriteBack after its payload has been
// dropped. Successful socket Close is not an acknowledgement of method exit.
type bridgeMixedUDPBlockedWrite struct {
	net.PacketConn
	entered chan struct{}
	release chan struct{}
}

func (c *bridgeMixedUDPBlockedWrite) WriteTo(b []byte, addr net.Addr) (int, error) {
	close(c.entered)
	<-c.release
	return c.PacketConn.WriteTo(b, addr)
}
func TestAndroidBridgeMixedUDPWriteBackTimeoutRequiresRetry(t *testing.T) {
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
	if _, err := socks.NewMixedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, bridgeMixedUDPConfig{pc: f}, h); err != nil {
		_ = pc.Close()
		t.Fatal(err)
	}
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
	if err := stopAndroidMixed(10 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("admitted mixed UDP write-back was not a stop timeout: %v", err)
	}
	if !androidRuntime.mixedCleanupPending {
		t.Fatal("write-back timeout forgot mixed UDP debt")
	}
	if err := applyAndroidConfigJSON(bridgeMixedConfig(t, 0)); !errors.Is(err, errAndroidMixedCleanupPending) {
		t.Fatalf("apply bypassed mixed UDP write-back debt: %v", err)
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
	if androidRuntime.mixedCleanupPending {
		t.Fatal("write-back debt survived acknowledged method exit")
	}
}
