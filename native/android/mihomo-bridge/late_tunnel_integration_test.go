package tunnel

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"runtime"
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
	tcp         C.Conn
	udp         C.PacketConn
	entered     chan struct{}
	release     chan struct{}
	enteredOnce sync.Once
}

func (p *lateGateProxy) Name() string                  { return "late-gate-proxy" }
func (p *lateGateProxy) Type() C.AdapterType           { return C.Direct }
func (p *lateGateProxy) IsL3Protocol(*C.Metadata) bool { return false }
func (p *lateGateProxy) SupportUDP() bool              { return true }
func (p *lateGateProxy) DialContext(ctx context.Context, metadata *C.Metadata) (C.Conn, error) {
	if p.Proxy != nil {
		return p.Proxy.DialContext(ctx, metadata)
	}
	p.enteredOnce.Do(func() { close(p.entered) })
	select {
	case <-p.release:
		return p.tcp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (p *lateGateProxy) ListenPacketContext(ctx context.Context, metadata *C.Metadata) (C.PacketConn, error) {
	if p.Proxy != nil {
		return p.Proxy.ListenPacketContext(ctx, metadata)
	}
	p.enteredOnce.Do(func() { close(p.entered) })
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

func lateGateWaitUpload(t *testing.T, before, want int64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		up, _ := statistic.DefaultManager.Total()
		if up-before == want {
			return
		}
		runtime.Gosched()
	}
	up, _ := statistic.DefaultManager.Total()
	t.Fatalf("timed out waiting for upload counter: got delta %d, want %d", up-before, want)
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

type lateGateTCPConn struct {
	N.ExtendedConn
	needHandshake bool
	writes        atomic.Int32
}

func (c *lateGateTCPConn) NeedHandshake() bool { return c.needHandshake }
func (c *lateGateTCPConn) Write(p []byte) (int, error) {
	c.writes.Add(1)
	return c.ExtendedConn.Write(p)
}

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
			remoteConn := &lateGateTCPConn{ExtendedConn: N.NewExtendedConn(remote), needHandshake: true}
			p := &lateGateProxy{tcp: remoteConn, entered: make(chan struct{}), release: make(chan struct{})}
			lateGateSetup(t, p)
			payload := []byte("already-peeked")
			br := bufio.NewReader(inbound)
			payloadWritten := make(chan error, 1)
			go func() { _, err := inboundPeer.Write(payload); payloadWritten <- err }()
			if peeked, err := br.Peek(len(payload)); err != nil || string(peeked) != string(payload) {
				t.Fatalf("failed to preload inbound peek: %q %v", peeked, err)
			}
			inboundConn := N.WarpConnWithBioReader(inbound, br)
			if err := <-payloadWritten; err != nil {
				t.Fatal(err)
			}
			beforeUpload, _ := statistic.DefaultManager.Total()
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
			go func() {
				defer close(done)
				handleTCPConn(icontext.NewConnContext(inboundConn, lateGateMetadata(C.TCP, 9)))
			}()
			lateGateWait(t, p.entered, "actual TCP proxy dial")
			if stale {
				statistic.DefaultManager.StopRegistrations()
				statistic.DefaultManager.StartRegistrations()
			}
			release()
			_ = remotePeer.SetReadDeadline(time.Now().Add(3 * time.Second))
			if stale {
				var b [1]byte
				if n, err := remotePeer.Read(b[:]); n != 0 || err != io.EOF {
					t.Fatalf("stale TCP result forwarded data or remained open: n=%d err=%v", n, err)
				}
				lateGateWait(t, done, "rejected TCP handler exit")
				if remoteConn.writes.Load() != 0 {
					t.Fatalf("stale early TCP connection wrote %d times", remoteConn.writes.Load())
				}
				if _, err := remote.Write([]byte("stale")); !errors.Is(err, io.ErrClosedPipe) {
					t.Fatalf("underlying stale TCP socket not closed: %v", err)
				}
				afterUpload, _ := statistic.DefaultManager.Total()
				if afterUpload != beforeUpload {
					t.Fatalf("stale early TCP upload changed by %d", afterUpload-beforeUpload)
				}
			} else {
				b := make([]byte, len(payload))
				if _, err := io.ReadFull(remotePeer, b); err != nil || string(b) != string(payload) {
					t.Fatalf("fresh TCP forwarding failed: %q %v", b, err)
				}
				if remoteConn.writes.Load() != 1 {
					t.Fatalf("fresh early TCP connection wrote %d times", remoteConn.writes.Load())
				}
				lateGateWaitUpload(t, beforeUpload, int64(len(payload)))
				afterUpload, _ := statistic.DefaultManager.Total()
				if delta := afterUpload - beforeUpload; delta != int64(len(payload)) {
					t.Fatalf("fresh early TCP upload delta=%d, want %d", delta, len(payload))
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

var errLateHandshakeSentinel = errors.New("late handshake sentinel")

type lateHandshakeConn struct {
	N.ExtendedConn
	chains    C.Chain
	writeErr  error
	writes    atomic.Int32
	closed    chan struct{}
	closeOnce sync.Once
}

func (c *lateHandshakeConn) NeedHandshake() bool { return true }
func (c *lateHandshakeConn) Write(p []byte) (int, error) {
	c.writes.Add(1)
	if c.writeErr != nil {
		return 0, c.writeErr
	}
	return c.ExtendedConn.Write(p)
}
func (c *lateHandshakeConn) Close() error {
	err := c.ExtendedConn.Close()
	c.closeOnce.Do(func() { close(c.closed) })
	return err
}
func (c *lateHandshakeConn) Chains() C.Chain               { return c.chains }
func (c *lateHandshakeConn) ProviderChains() C.Chain       { return nil }
func (c *lateHandshakeConn) AppendToChains(C.ProxyAdapter) {}
func (c *lateHandshakeConn) RemoteDestination() string     { return "127.0.0.1:9" }

type lateHandshakeProxy struct {
	C.Proxy
	conns       []C.Conn
	secondReady chan struct{}
	dials       atomic.Int32
}

func (p *lateHandshakeProxy) Name() string                  { return "late-handshake-proxy" }
func (p *lateHandshakeProxy) Type() C.AdapterType           { return C.Direct }
func (p *lateHandshakeProxy) IsL3Protocol(*C.Metadata) bool { return false }
func (p *lateHandshakeProxy) SupportUDP() bool              { return false }
func (p *lateHandshakeProxy) DialContext(ctx context.Context, _ *C.Metadata) (C.Conn, error) {
	i := int(p.dials.Add(1)) - 1
	if i >= len(p.conns) {
		return nil, errors.New("unexpected extra dial")
	}
	if i == 1 && p.secondReady != nil {
		select {
		case <-p.secondReady:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return p.conns[i], nil
}

func lateHandshakeTrackerCount() (count int) {
	statistic.DefaultManager.Range(func(statistic.Tracker) bool {
		count++
		return true
	})
	return count
}

func lateHandshakeWaitDone(t *testing.T, done <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func lateHandshakeConnPair(t *testing.T, writeErr error, chains C.Chain) (*lateHandshakeConn, net.Conn, net.Conn) {
	t.Helper()
	local, peer := net.Pipe()
	conn := &lateHandshakeConn{
		ExtendedConn: N.NewExtendedConn(local),
		chains:       chains,
		writeErr:     writeErr,
		closed:       make(chan struct{}),
	}
	return conn, local, peer
}

func TestAngelaNexusLateTunnelHandshakeRetry(t *testing.T) {
	first, firstLocal, firstPeer := lateHandshakeConnPair(t, errLateHandshakeSentinel, C.Chain{"late-retry"})
	second, secondLocal, secondPeer := lateHandshakeConnPair(t, nil, C.Chain{"late-retry"})
	proxy := &lateHandshakeProxy{conns: []C.Conn{first, second}, secondReady: make(chan struct{})}
	lateGateSetup(t, &lateGateProxy{Proxy: proxy})

	inbound, inboundPeer := net.Pipe()
	payload := []byte("successful-handshake-bytes")
	br := bufio.NewReader(inbound)
	payloadWritten := make(chan error, 1)
	go func() { _, err := inboundPeer.Write(payload); payloadWritten <- err }()
	if peeked, err := br.Peek(len(payload)); err != nil || string(peeked) != string(payload) {
		t.Fatalf("failed to preload inbound peek: %q %v", peeked, err)
	}
	if err := <-payloadWritten; err != nil {
		t.Fatal(err)
	}
	inboundConn := N.WarpConnWithBioReader(inbound, br)
	done := make(chan struct{})
	beforeUpload, _ := statistic.DefaultManager.Total()
	var releaseSecond sync.Once
	release := func() { releaseSecond.Do(func() { close(proxy.secondReady) }) }
	t.Cleanup(func() {
		release()
		_ = inboundPeer.Close()
		_ = firstPeer.Close()
		_ = secondPeer.Close()
		_ = firstLocal.Close()
		_ = secondLocal.Close()
		lateHandshakeWaitDone(t, done, "retry TCP handler exit")
	})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(inboundConn, lateGateMetadata(C.TCP, 9)))
	}()

	select {
	case <-first.closed:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for failed tracker close")
	}
	if got := lateHandshakeTrackerCount(); got != 0 {
		t.Fatalf("failed handshake left %d tracker(s), want 0", got)
	}
	release()

	_ = secondPeer.SetReadDeadline(time.Now().Add(3 * time.Second))
	gotPayload := make([]byte, len(payload))
	if _, err := io.ReadFull(secondPeer, gotPayload); err != nil || string(gotPayload) != string(payload) {
		t.Fatalf("retry handshake forwarding failed: %q %v", gotPayload, err)
	}
	if proxy.dials.Load() != 2 || first.writes.Load() != 1 || second.writes.Load() != 1 {
		t.Fatalf("unexpected retry activity: dials=%d firstWrites=%d secondWrites=%d", proxy.dials.Load(), first.writes.Load(), second.writes.Load())
	}
	if got := lateHandshakeTrackerCount(); got != 1 {
		t.Fatalf("successful retry has %d tracker(s), want 1", got)
	}
	lateGateWaitUpload(t, beforeUpload, int64(len(payload)))
	afterUpload, _ := statistic.DefaultManager.Total()
	if delta := afterUpload - beforeUpload; delta != int64(len(payload)) {
		t.Fatalf("manager upload delta=%d, want %d", delta, len(payload))
	}
}

func TestAngelaNexusLateTunnelRejectHandshake(t *testing.T) {
	reject, rejectLocal, rejectPeer := lateHandshakeConnPair(t, errLateHandshakeSentinel, C.Chain{"REJECT"})
	proxy := &lateHandshakeProxy{conns: []C.Conn{reject}}
	lateGateSetup(t, &lateGateProxy{Proxy: proxy})
	inbound, inboundPeer := net.Pipe()
	br := bufio.NewReader(inbound)
	payload := []byte("rejected-handshake")
	payloadWritten := make(chan error, 1)
	go func() { _, err := inboundPeer.Write(payload); payloadWritten <- err }()
	if peeked, err := br.Peek(len(payload)); err != nil || string(peeked) != string(payload) {
		t.Fatalf("failed to preload reject peek: %q %v", peeked, err)
	}
	if err := <-payloadWritten; err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	t.Cleanup(func() {
		_ = inboundPeer.Close()
		_ = rejectPeer.Close()
		_ = rejectLocal.Close()
		lateHandshakeWaitDone(t, done, "REJECT TCP handler exit")
	})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(N.WarpConnWithBioReader(inbound, br), lateGateMetadata(C.TCP, 9)))
	}()
	lateHandshakeWaitDone(t, done, "REJECT TCP handler exit")
	if proxy.dials.Load() != 1 || reject.writes.Load() < 1 {
		t.Fatalf("REJECT retried unexpectedly: dials=%d writes=%d", proxy.dials.Load(), reject.writes.Load())
	}
	if got := lateHandshakeTrackerCount(); got != 0 {
		t.Fatalf("REJECT left %d tracker(s), want 0", got)
	}
	select {
	case <-reject.closed:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for REJECT tracker close")
	}
}

type lateNATSender struct{ id byte }

func (*lateNATSender) Send(C.PacketAdapter)                       {}
func (*lateNATSender) Process(C.PacketConn, C.WriteBackProxy)     {}
func (*lateNATSender) Close()                                     {}
func (*lateNATSender) DoSniff(*C.Metadata) error                  { return nil }
func (*lateNATSender) AddMapping(*C.Metadata, *C.Metadata)        {}
func (*lateNATSender) RestoreReadFrom(addr netip.Addr) netip.Addr { return addr }

type lateCountingUDPProxy struct {
	C.Proxy
	udp   C.PacketConn
	calls atomic.Int32
}

func (p *lateCountingUDPProxy) Name() string                  { return "late-counting-udp" }
func (p *lateCountingUDPProxy) Type() C.AdapterType           { return C.Direct }
func (p *lateCountingUDPProxy) IsL3Protocol(*C.Metadata) bool { return false }
func (p *lateCountingUDPProxy) SupportUDP() bool              { return true }
func (p *lateCountingUDPProxy) ListenPacketContext(context.Context, *C.Metadata) (C.PacketConn, error) {
	if p.calls.Add(1) != 1 {
		return nil, errors.New("unexpected replacement dial")
	}
	return p.udp, nil
}

func lateNATConn(t *testing.T) *lateGatePacketConn {
	t.Helper()
	raw, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	conn := &lateGatePacketConn{EnhancePacketConn: N.NewEnhancePacketConn(raw), closed: make(chan struct{}), readDone: make(chan struct{})}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}
func lateNATPeer(t *testing.T) *net.UDPConn {
	t.Helper()
	peer, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	return peer
}
func lateNATRead(t *testing.T, peer *net.UDPConn, want string) {
	t.Helper()
	_ = peer.SetReadDeadline(time.Now().Add(3 * time.Second))
	var buf [64]byte
	n, _, err := peer.ReadFromUDP(buf[:])
	if err != nil || string(buf[:n]) != want {
		t.Fatalf("UDP payload=%q err=%v, want %q", buf[:n], err, want)
	}
}

func TestAngelaNexusLateTunnelUDPReplacementSameRawKey(t *testing.T) {
	oldConn, freshConn := lateNATConn(t), lateNATConn(t)
	peer := lateNATPeer(t)
	oldProxy := &lateGateProxy{udp: oldConn, entered: make(chan struct{}), release: make(chan struct{})}
	freshProxy := &lateCountingUDPProxy{udp: freshConn}
	lateGateSetup(t, oldProxy)
	local := oldConn.LocalAddr()
	metadata := lateGateMetadata(C.UDP, uint16(peer.LocalAddr().(*net.UDPAddr).Port))
	makePacket := func(payload string) *lateGatePacket {
		return &lateGatePacket{data: []byte(payload), local: local, dropped: make(chan struct{})}
	}
	oldPacket, first, second := makePacket("old"), makePacket("fresh-before-old-exit"), makePacket("fresh-after-old-exit")
	var once sync.Once
	release := func() { once.Do(func() { close(oldProxy.release) }) }
	t.Cleanup(func() {
		release()
		_ = oldConn.Close()
		_ = freshConn.Close()
		lateGateWait(t, oldPacket.dropped, "old packet release")
		lateGateWait(t, first.dropped, "first fresh packet release")
		lateGateWait(t, second.dropped, "second fresh packet release")
		lateGateWait(t, freshConn.readDone, "fresh UDP reader exit")
	})
	handleUDPConn(C.NewPacketAdapter(oldPacket, metadata.Clone()))
	lateGateWait(t, oldProxy.entered, "old proxy ListenPacketContext")
	statistic.DefaultManager.StopRegistrations()
	statistic.DefaultManager.StartRegistrations()
	UpdateProxies(map[string]C.Proxy{"GLOBAL": freshProxy, "DIRECT": freshProxy}, nil)
	// The old dial is still blocked. A same-raw-key packet must get its own
	// generation's sender and transfer real bytes before the old dial exits.
	handleUDPConn(C.NewPacketAdapter(first, metadata.Clone()))
	lateNATRead(t, peer, "fresh-before-old-exit")
	lateGateWait(t, first.dropped, "first fresh packet processing")
	release()
	lateGateWait(t, oldConn.closed, "stale result close")
	lateGateWait(t, oldPacket.dropped, "stale packet drop")
	if oldConn.reads.Load() != 0 || oldConn.writes.Load() != 0 {
		t.Fatalf("old relay ran: reads=%d writes=%d", oldConn.reads.Load(), oldConn.writes.Load())
	}
	handleUDPConn(C.NewPacketAdapter(second, metadata.Clone()))
	lateNATRead(t, peer, "fresh-after-old-exit")
	lateGateWait(t, second.dropped, "second fresh packet processing")
	if freshProxy.calls.Load() != 1 || freshConn.writes.Load() != 2 {
		t.Fatalf("replacement was redialed: dials=%d writes=%d", freshProxy.calls.Load(), freshConn.writes.Load())
	}
}

func TestAngelaNexusLateTunnelNATReplacementOwnsCleanup(t *testing.T) {
	local, peer := lateNATPeer(t), lateNATPeer(t)
	key := "round22-replacement-" + local.LocalAddr().String()
	old, fresh := &lateNATSender{id: 1}, &lateNATSender{id: 2}
	natTable.GetOrCreate(key, func() C.PacketSender { return old })
	if !natTable.DeleteIf(key, old) {
		t.Fatal("old entry was not removed")
	}
	natTable.GetOrCreate(key, func() C.PacketSender { return fresh })
	t.Cleanup(func() { closeAllLocalCoon(key, fresh) })
	if !natTable.AddForLocalConn(key, "peer", local) {
		t.Fatal("missing replacement entry")
	}
	if natTable.DeleteIf(key, old) {
		t.Fatal("old failed-dial cleanup removed replacement")
	}
	closeAllLocalCoon(key, old)
	if natTable.GetForLocalConn(key, "peer") != local {
		t.Fatal("old receive cleanup removed replacement")
	}
	if _, err := local.WriteToUDP([]byte("replacement-open"), peer.LocalAddr().(*net.UDPAddr)); err != nil {
		t.Fatal(err)
	}
	lateNATRead(t, peer, "replacement-open")
	// Retain a second remote mapping and creation-lock lookup on the same key.
	other := lateNATPeer(t)
	if !natTable.AddForLocalConn(key, "other", other) {
		t.Fatal("missing second remote mapping")
	}
	if cond, loaded := natTable.GetOrCreateLockForLocalConn(key, "peer"); cond == nil || loaded {
		t.Fatal("first creation lock lookup failed")
	}
	if cond, loaded := natTable.GetOrCreateLockForLocalConn(key, "peer"); cond == nil || !loaded {
		t.Fatal("creation lock lookup was not reused")
	}
	closeAllLocalCoon(key, fresh)
	for _, conn := range []*net.UDPConn{local, other} {
		if _, err := conn.WriteToUDP([]byte("closed"), peer.LocalAddr().(*net.UDPAddr)); !errors.Is(err, net.ErrClosed) {
			t.Fatalf("owned local socket not closed: %v", err)
		}
	}
}

func TestAngelaNexusLateTunnelTPROXYBareNATKey(t *testing.T) {
	conn, peer := lateNATConn(t), lateNATPeer(t)
	proxy := &lateGateProxy{udp: conn, entered: make(chan struct{}), release: make(chan struct{})}
	lateGateSetup(t, proxy)
	metadata := lateGateMetadata(C.UDP, uint16(peer.LocalAddr().(*net.UDPAddr).Port))
	metadata.Type = C.TPROXY
	packet := &lateGatePacket{data: []byte("tproxy-bare-key"), local: conn.LocalAddr(), dropped: make(chan struct{})}
	adapter := C.NewPacketAdapter(packet, metadata)
	var once sync.Once
	release := func() { once.Do(func() { close(proxy.release) }) }
	t.Cleanup(func() {
		release()
		_ = conn.Close()
		lateGateWait(t, packet.dropped, "TPROXY packet release")
		lateGateWait(t, conn.readDone, "TPROXY reader exit")
	})
	handleUDPConn(adapter)
	lateGateWait(t, proxy.entered, "TPROXY proxy dial")
	local := lateNATPeer(t)
	// Use the actual PacketAdapter key, not an unrelated synthetic entry.
	if !natTable.AddForLocalConn(adapter.Key(), "peer", local) || natTable.GetForLocalConn(adapter.Key(), "peer") != local {
		t.Fatal("actual non-TUN sender did not preserve the bare-key local map contract")
	}
	if cond, _ := natTable.GetOrCreateLockForLocalConn(adapter.Key(), "peer"); cond == nil {
		t.Fatal("bare-key creation lock absent")
	}
	closeAllLocalCoon(adapter.Key(), &lateNATSender{id: 9})
	if _, err := local.WriteToUDP([]byte("local-still-open"), peer.LocalAddr().(*net.UDPAddr)); err != nil {
		t.Fatal(err)
	}
	lateNATRead(t, peer, "local-still-open")
	release()
	lateNATRead(t, peer, "tproxy-bare-key")
	lateGateWait(t, packet.dropped, "TPROXY forwarding complete")
}
