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
	tcp           C.Conn
	udp           C.PacketConn
	entered       chan struct{}
	release       chan struct{}
	enteredOnce   sync.Once
	canceled      chan struct{}
	canceledOnce  sync.Once
	ignoreContext bool
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
	ctxDone := ctx.Done()
	if p.ignoreContext {
		ctxDone = nil
	}
	select {
	case <-p.release:
		return p.tcp, nil
	case <-ctxDone:
		if p.canceled != nil {
			p.canceledOnce.Do(func() { close(p.canceled) })
		}
		return nil, ctx.Err()
	}
}
func (p *lateGateProxy) ListenPacketContext(ctx context.Context, metadata *C.Metadata) (C.PacketConn, error) {
	if p.Proxy != nil {
		return p.Proxy.ListenPacketContext(ctx, metadata)
	}
	p.enteredOnce.Do(func() { close(p.entered) })
	ctxDone := ctx.Done()
	if p.ignoreContext {
		ctxDone = nil
	}
	select {
	case <-p.release:
		return p.udp, nil
	case <-ctxDone:
		if p.canceled != nil {
			p.canceledOnce.Do(func() { close(p.canceled) })
		}
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
	for _, mode := range []string{"fresh-forwarding", "canceled-dial", "old-result-after-restart"} {
		name := mode
		stale := mode != "fresh-forwarding"
		ignoreContext := mode == "old-result-after-restart"
		t.Run(name, func(t *testing.T) {
			remote, remotePeer := net.Pipe()
			inbound, inboundPeer := net.Pipe()
			remoteConn := &lateGateTCPConn{ExtendedConn: N.NewExtendedConn(remote), needHandshake: true}
			p := &lateGateProxy{tcp: remoteConn, entered: make(chan struct{}), release: make(chan struct{}), canceled: make(chan struct{}), ignoreContext: ignoreContext}
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
				if ignoreContext {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
					if err := statistic.DefaultManager.WaitSetups(ctx); !errors.Is(err, context.DeadlineExceeded) {
						t.Fatalf("blocked actual dial disappeared from setup ledger: %v", err)
					}
					cancel()
				} else {
					lateGateWaitSetups(t)
				}
				statistic.DefaultManager.StartRegistrations()
				if !ignoreContext {
					lateGateWait(t, p.canceled, "TCP setup context cancellation")
				}
			}
			release()
			if stale {
				statistic.DefaultManager.StopRegistrations()
				lateGateWaitSetups(t)
				lateGateWait(t, done, "rejected TCP handler exit")
				if ignoreContext {
					_ = remotePeer.SetReadDeadline(time.Now().Add(3 * time.Second))
					var b [1]byte
					if n, err := remotePeer.Read(b[:]); n != 0 || err != io.EOF {
						t.Fatalf("stale TCP result forwarded data or remained open: n=%d err=%v", n, err)
					}
					if _, err := remote.Write([]byte("stale")); !errors.Is(err, io.ErrClosedPipe) {
						t.Fatalf("underlying stale TCP socket not closed: %v", err)
					}
				}
				if remoteConn.writes.Load() != 0 {
					t.Fatalf("stale early TCP connection wrote %d times", remoteConn.writes.Load())
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
				statistic.DefaultManager.StopRegistrations()
				lateGateWaitSetups(t)
				select {
				case <-done:
					t.Fatal("fresh TCP relay exited before setup-only drain")
				default:
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
	for _, mode := range []string{"fresh-forwarding", "canceled-dial", "old-result-after-restart"} {
		name := mode
		stale := mode != "fresh-forwarding"
		ignoreContext := mode == "old-result-after-restart"
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
			p := &lateGateProxy{udp: conn, entered: make(chan struct{}), release: make(chan struct{}), canceled: make(chan struct{}), ignoreContext: ignoreContext}
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
				if ignoreContext {
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
					if err := statistic.DefaultManager.WaitSetups(ctx); !errors.Is(err, context.DeadlineExceeded) {
						t.Fatalf("blocked actual dial disappeared from setup ledger: %v", err)
					}
					cancel()
				} else {
					lateGateWaitSetups(t)
				}
				statistic.DefaultManager.StartRegistrations()
				if !ignoreContext {
					lateGateWait(t, p.canceled, "UDP setup context cancellation")
				}
			}
			release()
			if stale {
				statistic.DefaultManager.StopRegistrations()
				lateGateWaitSetups(t)
				lateGateWait(t, packet.dropped, "stale UDP packet drop")
				if ignoreContext {
					lateGateWait(t, conn.closed, "rejected UDP connection close")
					if _, err := raw.WriteTo([]byte("stale"), peer.LocalAddr()); !errors.Is(err, net.ErrClosed) {
						t.Fatalf("underlying stale UDP socket not closed: %v", err)
					}
				}
				if conn.reads.Load() != 0 || conn.writes.Load() != 0 {
					t.Fatalf("stale UDP relay started: reads=%d writes=%d", conn.reads.Load(), conn.writes.Load())
				}
			} else {
				_ = peer.SetReadDeadline(time.Now().Add(3 * time.Second))
				var b [16]byte
				n, _, err := peer.ReadFrom(b[:])
				if err != nil || string(b[:n]) != "payload" {
					t.Fatalf("fresh UDP forwarding failed: %q %v", b[:n], err)
				}
				statistic.DefaultManager.StopRegistrations()
				lateGateWaitSetups(t)
				select {
				case <-conn.readDone:
					t.Fatal("fresh UDP relay exited before setup-only drain")
				default:
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
	oldProxy := &lateGateProxy{udp: oldConn, entered: make(chan struct{}), release: make(chan struct{}), ignoreContext: true}
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

func TestAngelaNexusLateTunnelRetryCanceledBeforeFirstAttempt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	calls := 0
	_, err := retry(ctx, func(context.Context) (int, error) { calls++; return 0, nil }, nil)
	if !errors.Is(err, context.Canceled) || calls != 0 {
		t.Fatalf("canceled retry: calls=%d err=%v", calls, err)
	}
}

func TestAngelaNexusLateTunnelRetryCancelBetweenAttempts(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	reported := 0
	_, err := retry(ctx, func(context.Context) (int, error) { calls++; return 0, errors.New("retryable") }, func(error) { reported++; cancel() })
	if err == nil || calls != 1 || reported != 1 {
		t.Fatalf("retry continued after cancellation: calls=%d reports=%d err=%v", calls, reported, err)
	}
}

func lateGateWaitSetups(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := statistic.DefaultManager.WaitSetups(ctx); err != nil {
		t.Fatalf("actual setup did not drain: %v", err)
	}
}

// Queue ownership is independent of setup admission: an old sender must not
// retain a packet after Close, even if Send was already racing with that close.
type lateQueuePacket struct {
	C.PacketAdapter
	drops  atomic.Int32
	onDrop func()
}

func (p *lateQueuePacket) Drop() {
	p.drops.Add(1)
	if p.onDrop != nil {
		p.onDrop()
	}
}

func TestAngelaNexusLateTunnelSenderQueueCloseRace(t *testing.T) {
	for round := 0; round < 512; round++ {
		s := newPacketSender().(*packetSender)
		const count = 64
		packets := make([]lateQueuePacket, count)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for i := range packets {
			wg.Add(1)
			go func(p *lateQueuePacket) {
				defer wg.Done()
				<-start
				s.Send(p)
			}(&packets[i])
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			s.Close()
		}()
		close(start)
		wg.Wait()
		// Do not close again before checking: a second drain masks the leak.
		if n := len(s.ch); n != 0 {
			s.Close()
			t.Fatalf("round %d: closed sender retained %d queued packets", round, n)
		}
		for i := range packets {
			if got := packets[i].drops.Load(); got != 1 {
				t.Fatalf("round %d packet %d: Drop calls = %d, want 1", round, i, got)
			}
		}
	}
}

func TestAngelaNexusLateTunnelSenderDropCanReenter(t *testing.T) {
	for _, mode := range []string{"queue-drain", "queue-full", "already-closed"} {
		t.Run(mode, func(t *testing.T) {
			s := newPacketSender().(*packetSender)
			nested := &lateQueuePacket{}
			outer := &lateQueuePacket{onDrop: func() {
				s.Close()
				s.Send(nested)
			}}
			if mode == "queue-drain" {
				s.Send(outer)
			} else if mode == "queue-full" {
				for i := 0; i < cap(s.ch); i++ {
					s.Send(&lateQueuePacket{})
				}
			} else {
				s.Close()
			}
			done := make(chan struct{})
			go func() {
				defer close(done)
				if mode == "queue-drain" {
					s.Close()
				} else {
					s.Send(outer)
				}
			}()
			lateGateWait(t, done, "reentrant packet Drop outside queue mutex")
			if outer.drops.Load() != 1 || nested.drops.Load() != 1 || len(s.ch) != 0 {
				t.Fatalf("packet ownership lost: outer=%d nested=%d queued=%d", outer.drops.Load(), nested.drops.Load(), len(s.ch))
			}
			s.Close()
		})
	}
}

func TestAngelaNexusLateTunnelSenderConcurrentClosesDropOnce(t *testing.T) {
	s := newPacketSender().(*packetSender)
	packets := make([]lateQueuePacket, cap(s.ch))
	for i := range packets {
		s.Send(&packets[i])
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.Close() }()
	}
	wg.Wait()
	for i := range packets {
		if got := packets[i].drops.Load(); got != 1 {
			t.Fatalf("packet %d: concurrent Close dropped %d times", i, got)
		}
	}
	if len(s.ch) != 0 {
		t.Fatal("concurrent Close left queued packets")
	}
}

// These tests synchronize on callbacks, not sleeps: Close must prevent the next
// forwarding stage once the callback returns. Already-entered writes are not joined.
type lateProcessPacket struct {
	lateQueuePacket
	metadata  *C.Metadata
	onData    func()
	dataCalls atomic.Int32
}

func (p *lateProcessPacket) Metadata() *C.Metadata { return p.metadata }
func (p *lateProcessPacket) Data() []byte {
	p.dataCalls.Add(1)
	if p.onData != nil {
		p.onData()
	}
	return []byte("sender-stage-payload")
}

type lateProcessConn struct {
	C.PacketConn
	resolve   func(context.Context, *C.Metadata) error
	writes    atomic.Int32
	deadlines atomic.Int32
	onWrite   func()
}

func (c *lateProcessConn) ResolveUDP(ctx context.Context, m *C.Metadata) error {
	return c.resolve(ctx, m)
}
func (c *lateProcessConn) WriteTo(b []byte, _ net.Addr) (int, error) {
	c.writes.Add(1)
	if c.onWrite != nil {
		c.onWrite()
	}
	return len(b), nil
}
func (c *lateProcessConn) SetReadDeadline(time.Time) error { c.deadlines.Add(1); return nil }

type lateProcessWriteBack struct {
	C.WriteBackProxy
	update func()
	calls  atomic.Int32
}

func (p *lateProcessWriteBack) UpdateWriteBack(C.WriteBack) { p.calls.Add(1); p.update() }

func TestAngelaNexusLateTunnelSenderResolveAfterClose(t *testing.T) {
	for _, mode := range []string{"late-success", "late-error", "fresh-success"} {
		t.Run(mode, func(t *testing.T) {
			s := newPacketSender().(*packetSender)
			metadata := lateGateMetadata(C.UDP, 9)
			metadata.Host = "sender-stage.invalid"
			metadata.DstIP = netip.Addr{}
			p := &lateProcessPacket{metadata: metadata}
			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			c := &lateProcessConn{resolve: func(ctx context.Context, m *C.Metadata) error {
				close(entered)
				<-release // deliberately ignore cancellation and report a late result
				if mode != "fresh-success" && ctx.Err() == nil {
					return errors.New("missing cancellation")
				}
				m.DstIP = netip.MustParseAddr("127.0.0.1")
				if mode == "late-error" {
					return errors.New("late resolver failure")
				}
				return nil
			}}
			t.Cleanup(func() { s.Close(); unblock(); lateGateWait(t, done, "resolver Process exit") })
			// Drop re-enters Close and ends the fresh control's Process loop too.
			p.onDrop = s.Close
			s.Send(p)
			go func() { defer close(done); s.Process(c, nil) }()
			lateGateWait(t, entered, "dequeued packet resolver")
			if mode != "fresh-success" {
				s.Close()
			}
			if p.drops.Load() != 0 {
				t.Fatal("Close reclaimed a packet still owned by resolver")
			}
			unblock()
			lateGateWait(t, done, "resolved Process exit")
			want := int32(0)
			if mode == "fresh-success" {
				want = 1
			}
			if c.writes.Load() != want || c.deadlines.Load() != want || p.dataCalls.Load() != want || p.drops.Load() != 1 {
				t.Fatalf("stage ownership: writes=%d deadlines=%d data=%d drops=%d want forwarding=%d", c.writes.Load(), c.deadlines.Load(), p.dataCalls.Load(), p.drops.Load(), want)
			}
			if mode != "fresh-success" && len(s.originToTarget) != 0 {
				t.Fatal("canceled resolution installed a NAT mapping")
			}
		})
	}
}

func TestAngelaNexusLateTunnelSenderCallbackClose(t *testing.T) {
	for _, mode := range []string{"write-back", "data", "write-entered", "fresh"} {
		t.Run(mode, func(t *testing.T) {
			s := newPacketSender().(*packetSender)
			p := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
			p.onDrop = s.Close
			c := &lateProcessConn{}
			proxy := &lateProcessWriteBack{update: func() {}}
			switch mode {
			case "write-back":
				proxy.update = s.Close
			case "data":
				p.onData = s.Close
			case "write-entered":
				c.onWrite = s.Close
			}
			s.Send(p)
			done := make(chan struct{})
			go func() { defer close(done); s.Process(c, proxy) }()
			t.Cleanup(func() { s.Close(); lateGateWait(t, done, "callback Process exit") })
			lateGateWait(t, done, "reentrant close through sender callback")
			wantWrites, wantData, wantDeadlines := int32(0), int32(1), int32(0)
			if mode == "write-back" {
				wantData = 0
			}
			if mode == "fresh" || mode == "write-entered" {
				wantWrites = 1
			}
			if mode == "fresh" {
				wantDeadlines = 1
			}
			if p.drops.Load() != 1 || proxy.calls.Load() != 1 || c.writes.Load() != wantWrites || p.dataCalls.Load() != wantData || c.deadlines.Load() != wantDeadlines {
				t.Fatalf("callback stages: drops=%d proxy=%d writes=%d data=%d deadlines=%d", p.drops.Load(), proxy.calls.Load(), c.writes.Load(), p.dataCalls.Load(), c.deadlines.Load())
			}
		})
	}
}

func TestAngelaNexusLateTunnelSenderCanceledDequeued(t *testing.T) {
	// Inject the already-owned queue state directly so both select arms are ready.
	// Production Send cannot enqueue after Close; this targets Process selection.
	for i := 0; i < 128; i++ {
		s := newPacketSender().(*packetSender)
		s.Close()
		p := &lateQueuePacket{onDrop: s.Close}
		s.ch <- p
		proxy := &lateProcessWriteBack{update: func() { t.Error("canceled dequeue updated write-back") }}
		s.Process(nil, proxy)
		s.Close() // if cancellation won select, Close still owns the queued packet
		if p.drops.Load() != 1 || proxy.calls.Load() != 0 || len(s.ch) != 0 {
			t.Fatal("canceled dequeue ownership lost")
		}
	}
}

func TestAngelaNexusLateTunnelSenderWriteBackAfterClose(t *testing.T) {
	s := newPacketSender().(*packetSender)
	p := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	p.onDrop = s.Close
	c := &lateProcessConn{}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	proxy := &lateProcessWriteBack{update: func() { close(entered); <-release }}
	s.Send(p)
	go func() { defer close(done); s.Process(c, proxy) }()
	t.Cleanup(func() { s.Close(); unblock(); lateGateWait(t, done, "blocked write-back exit") })
	lateGateWait(t, entered, "write-back entry")
	closed := make(chan struct{})
	go func() { s.Close(); close(closed) }()
	lateGateWait(t, closed, "Close independent of blocked write-back")
	if p.drops.Load() != 0 {
		t.Fatal("Close dropped a packet still owned by write-back")
	}
	unblock()
	lateGateWait(t, done, "write-back return after cancellation")
	if p.drops.Load() != 1 || c.writes.Load() != 0 || p.dataCalls.Load() != 0 {
		t.Fatal("late write-back forwarded or lost packet ownership")
	}
}

func TestAngelaNexusLateTunnelSenderInFlightWrite(t *testing.T) {
	s := newPacketSender().(*packetSender)
	p := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	p.onDrop = s.Close
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	c := &lateProcessConn{onWrite: func() { close(entered); <-release }}
	s.Send(p)
	go func() { defer close(done); s.Process(c, nil) }()
	t.Cleanup(func() { s.Close(); unblock(); lateGateWait(t, done, "in-flight write exit") })
	lateGateWait(t, entered, "already-entered WriteTo")
	closed := make(chan struct{})
	go func() { s.Close(); close(closed) }()
	lateGateWait(t, closed, "Close independent of in-flight WriteTo")
	if p.drops.Load() != 0 {
		t.Fatal("Close released the packet before its write returned")
	}
	select {
	case <-done:
		t.Fatal("Process exited before its admitted write returned")
	default:
	}
	unblock()
	lateGateWait(t, done, "admitted write completion")
	if c.writes.Load() != 1 || c.deadlines.Load() != 0 || p.drops.Load() != 1 {
		t.Fatalf("in-flight ownership: writes=%d deadlines=%d drops=%d", c.writes.Load(), c.deadlines.Load(), p.drops.Load())
	}
}
