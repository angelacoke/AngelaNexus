package tunnel

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	N "github.com/metacubex/mihomo/common/net"
	C "github.com/metacubex/mihomo/constant"
	icontext "github.com/metacubex/mihomo/context"
	"github.com/metacubex/mihomo/tunnel/statistic"
)

// Embed the unused proxy surface, but override every method reached by these
// Global-mode handlers. The real connection wrappers still provide tracker data.
type lateGateProxy struct {
	C.Proxy
	tcp     C.Conn
	udp     C.PacketConn
	entered chan struct{}
	release chan struct{}
}

func (p *lateGateProxy) Name() string                  { return "late-gate-proxy" }
func (p *lateGateProxy) Type() C.AdapterType           { return C.Direct }
func (p *lateGateProxy) IsL3Protocol(*C.Metadata) bool { return false }
func (p *lateGateProxy) SupportUDP() bool              { return true }
func (p *lateGateProxy) DialContext(ctx context.Context, _ *C.Metadata) (C.Conn, error) {
	close(p.entered)
	select {
	case <-p.release:
		return p.tcp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (p *lateGateProxy) ListenPacketContext(ctx context.Context, _ *C.Metadata) (C.PacketConn, error) {
	close(p.entered)
	select {
	case <-p.release:
		return p.udp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func lateGateWait(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func lateGateSetup(t *testing.T, p *lateGateProxy) {
	t.Helper()
	oldProxies, oldMode, oldStatus := Proxies(), Mode(), Status()
	UpdateProxies(map[string]C.Proxy{"GLOBAL": p, "DIRECT": p}, nil)
	SetMode(Global)
	OnRunning()
	statistic.DefaultManager.StartRegistrations()
	t.Cleanup(func() {
		statistic.DefaultManager.StopRegistrations()
		UpdateProxies(oldProxies, nil)
		SetMode(oldMode)
		status.Store(oldStatus)
	})
}

func lateGateMetadata(network C.NetWork, port uint16) *C.Metadata {
	return &C.Metadata{NetWork: network, Type: C.TUN, DstIP: netip.MustParseAddr("127.0.0.1"), DstPort: port}
}

type lateGateTCPConn struct{ N.ExtendedConn }

func (c *lateGateTCPConn) Chains() C.Chain               { return C.Chain{"late-tunnel-tcp"} }
func (c *lateGateTCPConn) ProviderChains() C.Chain       { return nil }
func (c *lateGateTCPConn) AppendToChains(C.ProxyAdapter) {}
func (c *lateGateTCPConn) RemoteDestination() string     { return "127.0.0.1:9" }

func TestAngelaNexusLateTunnelTCP(t *testing.T) {
	for _, stale := range []bool{true, false} {
		name := "fresh-forwarding"
		if stale {
			name = "old-result-after-restart"
		}
		t.Run(name, func(t *testing.T) {
			remote, remotePeer := net.Pipe()
			inbound, inboundPeer := net.Pipe()
			p := &lateGateProxy{tcp: &lateGateTCPConn{N.NewExtendedConn(remote)}, entered: make(chan struct{}), release: make(chan struct{})}
			lateGateSetup(t, p)
			done := make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(p.release) }) }
			t.Cleanup(func() {
				release()
				_ = inboundPeer.Close()
				_ = remotePeer.Close()
				_ = remote.Close()
				lateGateWait(t, done, "TCP handler exit")
			})
			go func() { defer close(done); handleTCPConn(icontext.NewConnContext(inbound, lateGateMetadata(C.TCP, 9))) }()
			lateGateWait(t, p.entered, "actual TCP proxy dial")
			if stale {
				statistic.DefaultManager.StopRegistrations()
				statistic.DefaultManager.StartRegistrations()
			}
			release()
			_ = remotePeer.SetReadDeadline(time.Now().Add(3 * time.Second))
			if stale {
				lateGateWait(t, done, "rejected TCP handler exit")
				var b [1]byte
				if n, err := remotePeer.Read(b[:]); n != 0 || err != io.EOF {
					t.Fatalf("stale TCP result forwarded data or remained open: n=%d err=%v", n, err)
				}
				if _, err := remote.Write([]byte("stale")); !errors.Is(err, io.ErrClosedPipe) {
					t.Fatalf("underlying stale TCP socket not closed: %v", err)
				}
			} else {
				writeDone := make(chan error, 1)
				go func() { _, err := inboundPeer.Write([]byte("fresh")); writeDone <- err }()
				var b [5]byte
				if _, err := io.ReadFull(remotePeer, b[:]); err != nil || string(b[:]) != "fresh" {
					t.Fatalf("fresh TCP forwarding failed: %q %v", b, err)
				}
				if err := <-writeDone; err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

type lateGatePacketConn struct {
	N.EnhancePacketConn
	reads     atomic.Int32
	writes    atomic.Int32
	closed    chan struct{}
	readDone  chan struct{}
	closeOnce sync.Once
	readOnce  sync.Once
}

func (c *lateGatePacketConn) Close() error {
	err := c.EnhancePacketConn.Close()
	c.closeOnce.Do(func() { close(c.closed) })
	return err
}
func (c *lateGatePacketConn) WaitReadFrom() ([]byte, func(), net.Addr, error) {
	c.reads.Add(1)
	defer c.readOnce.Do(func() { close(c.readDone) })
	return c.EnhancePacketConn.WaitReadFrom()
}
func (c *lateGatePacketConn) WriteTo(b []byte, addr net.Addr) (int, error) {
	c.writes.Add(1)
	return c.EnhancePacketConn.WriteTo(b, addr)
}

func (c *lateGatePacketConn) Chains() C.Chain                               { return C.Chain{"late-tunnel-udp"} }
func (c *lateGatePacketConn) ProviderChains() C.Chain                       { return nil }
func (c *lateGatePacketConn) AppendToChains(C.ProxyAdapter)                 {}
func (c *lateGatePacketConn) RemoteDestination() string                     { return "127.0.0.1:9" }
func (c *lateGatePacketConn) ResolveUDP(context.Context, *C.Metadata) error { return nil }

type lateGatePacket struct {
	data    []byte
	local   net.Addr
	dropped chan struct{}
	once    sync.Once
}

func (p *lateGatePacket) Data() []byte                            { return p.data }
func (p *lateGatePacket) LocalAddr() net.Addr                     { return p.local }
func (p *lateGatePacket) WriteBack([]byte, net.Addr) (int, error) { return 0, net.ErrClosed }
func (p *lateGatePacket) Drop()                                   { p.once.Do(func() { close(p.dropped) }) }

func TestAngelaNexusLateTunnelUDP(t *testing.T) {
	for _, stale := range []bool{true, false} {
		name := "fresh-forwarding"
		if stale {
			name = "old-result-after-restart"
		}
		t.Run(name, func(t *testing.T) {
			raw, err := net.ListenPacket("udp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
			if err != nil {
				_ = raw.Close()
				t.Fatal(err)
			}
			conn := &lateGatePacketConn{EnhancePacketConn: N.NewEnhancePacketConn(raw), closed: make(chan struct{}), readDone: make(chan struct{})}
			p := &lateGateProxy{udp: conn, entered: make(chan struct{}), release: make(chan struct{})}
			lateGateSetup(t, p)
			packet := &lateGatePacket{data: []byte("payload"), local: raw.LocalAddr(), dropped: make(chan struct{})}
			adapter := C.NewPacketAdapter(packet, lateGateMetadata(C.UDP, uint16(peer.LocalAddr().(*net.UDPAddr).Port)))
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(p.release) }) }
			t.Cleanup(func() {
				release()
				_ = conn.Close()
				_ = peer.Close()
				lateGateWait(t, packet.dropped, "UDP packet release")
				if !stale {
					lateGateWait(t, conn.readDone, "UDP reader exit")
				}
			})
			handleUDPConn(adapter)
			lateGateWait(t, p.entered, "actual UDP proxy dial")
			if stale {
				statistic.DefaultManager.StopRegistrations()
				statistic.DefaultManager.StartRegistrations()
			}
			release()
			if stale {
				lateGateWait(t, conn.closed, "rejected UDP connection close")
				lateGateWait(t, packet.dropped, "stale UDP packet drop")
				if conn.reads.Load() != 0 || conn.writes.Load() != 0 {
					t.Fatalf("stale UDP relay started: reads=%d writes=%d", conn.reads.Load(), conn.writes.Load())
				}
				if _, err := raw.WriteTo([]byte("stale"), peer.LocalAddr()); !errors.Is(err, net.ErrClosed) {
					t.Fatalf("underlying stale UDP socket not closed: %v", err)
				}
			} else {
				_ = peer.SetReadDeadline(time.Now().Add(3 * time.Second))
				var b [16]byte
				n, _, err := peer.ReadFrom(b[:])
				if err != nil || string(b[:n]) != "payload" {
					t.Fatalf("fresh UDP forwarding failed: %q %v", b[:n], err)
				}
				lateGateWait(t, packet.dropped, "fresh UDP packet processed")
				if conn.writes.Load() != 1 {
					t.Fatalf("fresh UDP sent %d times", conn.writes.Load())
				}
			}
		})
	}
}
