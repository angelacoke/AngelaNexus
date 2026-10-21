package tunnel

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	N "github.com/metacubex/mihomo/common/net"
	S "github.com/metacubex/mihomo/component/sniffer"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/constant/sniffer"
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
				relayPayload := []byte("relay-after-early")
				go func() { _, _ = inboundPeer.Write(relayPayload) }()
				relayGot := make([]byte, len(relayPayload))
				if _, err := io.ReadFull(remotePeer, relayGot); err != nil || string(relayGot) != string(relayPayload) {
					t.Fatalf("fresh TCP relay did not start: %q %v", relayGot, err)
				}
				statistic.DefaultManager.StopRegistrations()
				lateGateWaitSetups(t)
				select {
				case <-done:
					t.Fatal("fresh TCP relay exited before setup-only drain")
				default:
				}
				lateGateWaitUpload(t, beforeUpload, int64(len(payload)+len(relayPayload)))
				afterUpload, _ := statistic.DefaultManager.Total()
				if delta := afterUpload - beforeUpload; delta != int64(len(payload)+len(relayPayload)) {
					t.Fatalf("fresh early TCP upload delta=%d, want %d", delta, len(payload)+len(relayPayload))
				}
			}
		})
	}
}

type lateGatePacketConn struct {
	N.EnhancePacketConn
	reads       atomic.Int32
	writes      atomic.Int32
	closed      chan struct{}
	readStarted chan struct{}
	readDone    chan struct{}
	closeOnce   sync.Once
	readOnce    sync.Once
}

func (c *lateGatePacketConn) Close() error {
	err := c.EnhancePacketConn.Close()
	c.closeOnce.Do(func() { close(c.closed) })
	return err
}
func (c *lateGatePacketConn) WaitReadFrom() ([]byte, func(), net.Addr, error) {
	if c.reads.Add(1) == 1 && c.readStarted != nil {
		close(c.readStarted)
	}
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
			conn := &lateGatePacketConn{EnhancePacketConn: N.NewEnhancePacketConn(raw), closed: make(chan struct{}), readStarted: make(chan struct{}), readDone: make(chan struct{})}
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
				// A received outbound request does not prove the reverse goroutine
				// entered its read. Cancellation before entry now correctly skips it.
				// This control specifically tests setup-only drain with a blocked read.
				lateGateWait(t, conn.readStarted, "fresh UDP reverse read entry")
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
	conns         []C.Conn
	secondReady   chan struct{}
	secondEntered chan struct{}
	dials         atomic.Int32
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
		if p.secondEntered != nil {
			close(p.secondEntered)
		}
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
	proxy := &lateHandshakeProxy{conns: []C.Conn{first, second}, secondReady: make(chan struct{}), secondEntered: make(chan struct{})}
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
	// The underlying Close signal precedes the tracker's manager.Leave. Wait
	// for the next dial to enter (but keep it blocked before registration),
	// proving the previous tracker Close, including Leave, has returned.
	lateHandshakeWaitDone(t, proxy.secondEntered, "retry dial after tracker cleanup")
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

type lateLocalReadConn struct {
	C.PacketConn
	readStarted    chan struct{}
	release        chan struct{}
	readOnce       sync.Once
	closeOnce      sync.Once
	closeCalls     atomic.Int32
	reads          atomic.Int32
	deadlines      atomic.Int32
	putCalls       *atomic.Int32
	deadlineCancel func()
	waitErr        error
	errorPut       bool
}

func (c *lateLocalReadConn) SetReadDeadline(time.Time) error {
	c.deadlines.Add(1)
	if c.deadlineCancel != nil {
		c.deadlineCancel()
	}
	return nil
}

func (c *lateLocalReadConn) WaitReadFrom() ([]byte, func(), net.Addr, error) {
	if c.reads.Add(1) > 1 {
		return nil, nil, nil, io.EOF
	}
	c.readOnce.Do(func() { close(c.readStarted) })
	if c.release != nil {
		<-c.release
	}
	if c.waitErr != nil {
		if !c.errorPut {
			return nil, nil, nil, c.waitErr
		}
		return nil, c.putFunc(), nil, c.waitErr
	}
	return []byte("reply"), c.putFunc(), &net.UDPAddr{IP: net.ParseIP("192.0.2.1"), Port: 5353}, nil
}

func (c *lateLocalReadConn) putFunc() func() {
	return func() {
		if c.putCalls != nil {
			c.putCalls.Add(1)
		}
	}
}

func (c *lateLocalReadConn) Close() error {
	c.closeOnce.Do(func() { c.closeCalls.Add(1) })
	return nil
}

type lateLocalSender struct {
	C.PacketSender
	closeOnce  sync.Once
	closeCalls atomic.Int32
	restores   atomic.Int32
	restore    func(netip.Addr)
}

func (s *lateLocalSender) Close() {
	s.closeOnce.Do(func() { s.closeCalls.Add(1) })
}

func (s *lateLocalSender) RestoreReadFrom(addr netip.Addr) netip.Addr {
	s.restores.Add(1)
	if s.restore != nil {
		s.restore(addr)
	}
	return addr
}

type lateLocalWriteBack struct {
	calls   atomic.Int32
	onWrite func()
	err     error
}

func (w *lateLocalWriteBack) WriteBack([]byte, net.Addr) (int, error) {
	w.calls.Add(1)
	if w.onWrite != nil {
		w.onWrite()
	}
	return 1, w.err
}

func TestAngelaNexusLateTunnelReplyLocalWriteBackCancellation(t *testing.T) {
	t.Run("blocked-read-late-buffer-is-dropped", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		readStarted, release := make(chan struct{}), make(chan struct{})
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: readStarted, release: release, putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{}
		// A blocked reader deliberately ignores Close/cancellation and returns a
		// valid buffer later. The post-read check must own it and call put once.
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-local-blocked", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, readStarted, "blocked local UDP read")
		cancel()
		close(release)
		lateGateWait(t, done, "blocked local UDP cleanup")
		if pc.reads.Load() != 1 || sender.restores.Load() != 0 || wb.calls.Load() != 0 || putCalls.Load() != 1 {
			t.Fatalf("late read forwarded: reads=%d restores=%d writes=%d puts=%d", pc.reads.Load(), sender.restores.Load(), wb.calls.Load(), putCalls.Load())
		}
		if sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("cleanup calls: sender=%d pc=%d", sender.closeCalls.Load(), pc.closeCalls.Load())
		}
	})

	t.Run("restore-reentrant-cancel", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{}
		sender.restore = func(netip.Addr) {
			cancel()
			sender.Close() // re-enter cleanup while RestoreReadFrom is executing
			_ = pc.Close()
		}
		pc.release = make(chan struct{})
		close(pc.release)
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-local-restore", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "restore cancellation cleanup")
		if wb.calls.Load() != 0 || putCalls.Load() != 1 || sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("restore cancellation: writes=%d puts=%d senderClose=%d pcClose=%d", wb.calls.Load(), putCalls.Load(), sender.closeCalls.Load(), pc.closeCalls.Load())
		}
	})

	t.Run("fresh-success", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-local-fresh", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "fresh local UDP cleanup")
		if wb.calls.Load() != 1 || putCalls.Load() != 1 || sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("fresh result: writes=%d puts=%d senderClose=%d pcClose=%d", wb.calls.Load(), putCalls.Load(), sender.closeCalls.Load(), pc.closeCalls.Load())
		}
	})

	t.Run("in-flight-writeback", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{onWrite: cancel}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-local-inflight", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "in-flight write-back cleanup")
		if wb.calls.Load() != 1 || putCalls.Load() != 1 || sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("in-flight write-back: writes=%d puts=%d senderClose=%d pcClose=%d", wb.calls.Load(), putCalls.Load(), sender.closeCalls.Load(), pc.closeCalls.Load())
		}
	})

	t.Run("blocked-writeback-retains-buffer", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		entered, release := make(chan struct{}), make(chan struct{})
		var releaseOnce sync.Once
		unblock := func() { releaseOnce.Do(func() { close(release) }) }
		defer unblock()
		var putCalls atomic.Int32
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{onWrite: func() { close(entered); <-release }}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-reply-blocked-write", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, entered, "blocked write-back entry")
		cancel()
		if putCalls.Load() != 0 || sender.closeCalls.Load() != 0 || pc.closeCalls.Load() != 0 {
			t.Fatal("in-flight write-back buffer released before callback return")
		}
		select {
		case <-done:
			t.Fatal("cancellation incorrectly joined or abandoned blocked write-back")
		default:
		}
		unblock()
		lateGateWait(t, done, "blocked write-back return")
		if wb.calls.Load() != 1 || putCalls.Load() != 1 || pc.reads.Load() != 1 || sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("blocked write-back ownership: writes=%d puts=%d reads=%d", wb.calls.Load(), putCalls.Load(), pc.reads.Load())
		}
	})

	t.Run("deadline-cancel-skips-read", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), deadlineCancel: cancel}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-reply-deadline", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "deadline cancellation cleanup")
		if pc.deadlines.Load() != 1 || pc.reads.Load() != 0 || wb.calls.Load() != 0 {
			t.Fatalf("deadline cancellation: deadlines=%d reads=%d writes=%d", pc.deadlines.Load(), pc.reads.Load(), wb.calls.Load())
		}
	})

	for _, tc := range []struct {
		name     string
		errorPut bool
	}{
		{name: "wait-error-returns-put", errorPut: true},
		{name: "wait-error-nil-put"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			putCalls := atomic.Int32{}
			pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls, waitErr: io.ErrUnexpectedEOF, errorPut: tc.errorPut}
			sender := &lateLocalSender{}
			wb := &lateLocalWriteBack{}
			done := make(chan struct{})
			go func() {
				defer close(done)
				handleUDPToLocal(ctx, wb, pc, sender, "late-reply-error", netip.MustParseAddrPort("127.0.0.1:9"))
			}()
			lateGateWait(t, done, "wait error cleanup")
			wantPut := int32(0)
			if tc.errorPut {
				wantPut = 1
			}
			if putCalls.Load() != wantPut || wb.calls.Load() != 0 {
				t.Fatalf("wait error: puts=%d want=%d writes=%d", putCalls.Load(), wantPut, wb.calls.Load())
			}
		})
	}

	t.Run("writeback-error-still-puts", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{err: io.ErrClosedPipe}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-reply-write-error", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "write-back error cleanup")
		if wb.calls.Load() != 1 || putCalls.Load() != 1 || pc.reads.Load() != 1 {
			t.Fatalf("write-back error ownership: writes=%d puts=%d reads=%d", wb.calls.Load(), putCalls.Load(), pc.reads.Load())
		}
	})

	t.Run("canceled-at-entry", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		putCalls := atomic.Int32{}
		pc := &lateLocalReadConn{readStarted: make(chan struct{}), putCalls: &putCalls}
		sender := &lateLocalSender{}
		wb := &lateLocalWriteBack{}
		done := make(chan struct{})
		go func() {
			defer close(done)
			handleUDPToLocal(ctx, wb, pc, sender, "late-local-entry", netip.MustParseAddrPort("127.0.0.1:9"))
		}()
		lateGateWait(t, done, "entry cancellation cleanup")
		if pc.reads.Load() != 0 || wb.calls.Load() != 0 || sender.closeCalls.Load() != 1 || pc.closeCalls.Load() != 1 {
			t.Fatalf("entry cancellation: reads=%d writes=%d senderClose=%d pcClose=%d", pc.reads.Load(), wb.calls.Load(), sender.closeCalls.Load(), pc.closeCalls.Load())
		}
	})
}

type lateReplyPacket struct {
	lateGatePacket
	replies chan []byte
}

func (p *lateReplyPacket) WriteBack(data []byte, _ net.Addr) (int, error) {
	p.replies <- append([]byte(nil), data...)
	return len(data), nil
}

func TestAngelaNexusLateTunnelReplyHandlerContextLifetime(t *testing.T) {
	raw, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		_ = raw.Close()
		t.Fatal(err)
	}
	conn := &lateGatePacketConn{
		EnhancePacketConn: N.NewEnhancePacketConn(raw),
		closed:            make(chan struct{}),
		readDone:          make(chan struct{}),
	}
	proxy := &lateGateProxy{
		udp:     conn,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	lateGateSetup(t, proxy)
	packet := &lateReplyPacket{
		lateGatePacket: lateGatePacket{
			data:    []byte("request"),
			local:   raw.LocalAddr(),
			dropped: make(chan struct{}),
		},
		replies: make(chan []byte, 1),
	}
	adapter := C.NewPacketAdapter(packet, lateGateMetadata(C.UDP, uint16(peer.LocalAddr().(*net.UDPAddr).Port)))
	t.Cleanup(func() {
		_ = conn.Close()
		_ = peer.Close()
		lateGateWait(t, packet.dropped, "reply packet release")
		lateGateWait(t, conn.readDone, "reply UDP reader exit")
	})
	close(proxy.release)
	handleUDPConn(adapter)
	lateGateWait(t, proxy.entered, "reply UDP proxy dial")

	_ = peer.SetReadDeadline(time.Now().Add(3 * time.Second))
	var request [32]byte
	n, addr, err := peer.ReadFrom(request[:])
	if err != nil || string(request[:n]) != "request" {
		t.Fatalf("fresh UDP request forwarding failed: %q %v", request[:n], err)
	}
	if _, err := peer.WriteTo([]byte("reply"), addr); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-packet.replies:
		if string(got) != "reply" {
			t.Fatalf("unexpected UDP reply payload: %q", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for fresh UDP write-back")
	}
	if conn.writes.Load() != 1 {
		t.Fatalf("fresh UDP sent %d times", conn.writes.Load())
	}
}

func TestAngelaNexusLateTunnelSenderParentCancelAfterResolve(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	s := newPacketSenderWithContext(parent).(*packetSender)
	metadata := lateGateMetadata(C.UDP, 9)
	metadata.Host = "parent-cancel.invalid"
	metadata.DstIP = netip.Addr{}
	p := &lateProcessPacket{metadata: metadata}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	c := &lateProcessConn{resolve: func(_ context.Context, m *C.Metadata) error {
		close(entered)
		<-release
		m.DstIP = netip.MustParseAddr("127.0.0.1")
		return nil
	}}
	t.Cleanup(func() { cancel(); unblock(); lateGateWait(t, done, "parent-canceled resolver Process exit") })
	s.Send(p)
	go func() { defer close(done); s.Process(c, nil) }()
	lateGateWait(t, entered, "parent-canceled resolver entry")
	cancel()
	unblock()
	lateGateWait(t, done, "parent-canceled resolver completion")
	if c.writes.Load() != 0 || p.dataCalls.Load() != 0 || p.drops.Load() != 1 {
		t.Fatalf("parent cancellation forwarded late resolver result: writes=%d data=%d drops=%d", c.writes.Load(), p.dataCalls.Load(), p.drops.Load())
	}
	fresh := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	s.Send(fresh)
	if fresh.drops.Load() != 1 {
		t.Fatalf("Send after parent cancellation dropped %d times, want 1", fresh.drops.Load())
	}
}

func TestAngelaNexusLateTunnelSenderParentCancelDrainsQueue(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	s := newPacketSenderWithContext(parent).(*packetSender)
	nested := &lateQueuePacket{}
	const count = 8
	packets := make([]lateProcessPacket, count)
	for i := range packets {
		packets[i].metadata = lateGateMetadata(C.UDP, 9)
		if i == 0 {
			packets[i].onDrop = func() { s.Close(); s.Send(nested) }
		}
		s.Send(&packets[i])
	}
	cancel()
	done := make(chan struct{})
	go func() { defer close(done); s.Process(nil, nil) }()
	lateGateWait(t, done, "parent-canceled queued Process exit")
	for i := range packets {
		if got := packets[i].drops.Load(); got != 1 {
			t.Fatalf("queued packet %d Drop calls=%d, want 1", i, got)
		}
	}
	if nested.drops.Load() != 1 {
		t.Fatal("reentrant nested packet not dropped exactly once")
	}
	if len(s.ch) != 0 {
		t.Fatalf("parent-canceled Process retained %d queued packets", len(s.ch))
	}
	late := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	s.Send(late)
	if late.drops.Load() != 1 {
		t.Fatalf("Send after drained cancellation dropped %d times, want 1", late.drops.Load())
	}
}

func TestAngelaNexusLateTunnelSenderParentCancelAfterWriteBack(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	s := newPacketSenderWithContext(parent).(*packetSender)
	first := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	second := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	proxy := &lateProcessWriteBack{update: func() { close(entered); <-release }}
	c := &lateProcessConn{}
	t.Cleanup(func() { cancel(); unblock(); lateGateWait(t, done, "parent-canceled write-back Process exit") })
	s.Send(first)
	s.Send(second)
	go func() { defer close(done); s.Process(c, proxy) }()
	lateGateWait(t, entered, "parent-canceled write-back entry")
	cancel()
	if first.drops.Load() != 0 || second.drops.Load() != 0 {
		t.Fatal("parent cancellation reclaimed packets before blocked write-back returned")
	}
	unblock()
	lateGateWait(t, done, "parent-canceled write-back completion")
	if first.drops.Load() != 1 || second.drops.Load() != 1 || proxy.calls.Load() != 1 || c.writes.Load() != 0 || first.dataCalls.Load() != 0 {
		t.Fatalf("write-back cancellation ownership: first=%d second=%d proxy=%d writes=%d data=%d", first.drops.Load(), second.drops.Load(), proxy.calls.Load(), c.writes.Load(), first.dataCalls.Load())
	}
}

func TestAngelaNexusLateTunnelSenderParentCancelFreshWrite(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	s := newPacketSenderWithContext(parent).(*packetSender)
	p := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9)}
	entered := make(chan struct{})
	c := &lateProcessConn{onWrite: func() { close(entered); cancel() }}
	done := make(chan struct{})
	s.Send(p)
	go func() { defer close(done); s.Process(c, nil) }()
	lateGateWait(t, entered, "fresh WriteTo entry")
	lateGateWait(t, done, "fresh parent-canceled Process exit")
	if c.writes.Load() != 1 || c.deadlines.Load() != 0 || p.dataCalls.Load() != 1 || p.drops.Load() != 1 {
		t.Fatalf("fresh admitted write was not completed: writes=%d deadlines=%d data=%d drops=%d", c.writes.Load(), c.deadlines.Load(), p.dataCalls.Load(), p.drops.Load())
	}
}

func TestAngelaNexusLateTunnelSenderParentCancelDataAndIdle(t *testing.T) {
	for _, mode := range []string{"data-cancel", "idle-cancel"} {
		t.Run(mode, func(t *testing.T) {
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := newPacketSenderWithContext(parent).(*packetSender)
			p := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 9), onData: cancel}
			c := &lateProcessConn{}
			done := make(chan struct{})
			if mode == "data-cancel" {
				s.Send(p)
			}
			go func() { defer close(done); s.Process(c, nil) }()
			if mode == "idle-cancel" {
				cancel()
			}
			lateGateWait(t, done, "parent cancel data/idle Process exit")
			want := int32(0)
			if mode == "data-cancel" {
				want = 1
			}
			if c.writes.Load() != 0 || c.deadlines.Load() != 0 || p.dataCalls.Load() != want || p.drops.Load() != want {
				t.Fatalf("data/idle cancellation: writes=%d data=%d drops=%d", c.writes.Load(), p.dataCalls.Load(), p.drops.Load())
			}
		})
	}
}

func TestAngelaNexusLateTunnelSenderHandlerParentCancellation(t *testing.T) {
	raw, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	peer, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		raw.Close()
		t.Fatal(err)
	}
	conn := &lateGatePacketConn{EnhancePacketConn: N.NewEnhancePacketConn(raw), closed: make(chan struct{}), readStarted: make(chan struct{}), readDone: make(chan struct{})}
	proxy := &lateGateProxy{udp: conn, entered: make(chan struct{}), release: make(chan struct{})}
	lateGateSetup(t, proxy)
	oldSniffing := sniffingEnable
	sniffingEnable = false
	defer func() { sniffingEnable = oldSniffing }()
	epoch, _ := statistic.DefaultManager.Registration()
	packet := &lateGatePacket{data: []byte("parent-generation"), local: raw.LocalAddr(), dropped: make(chan struct{})}
	adapter := C.NewPacketAdapter(packet, lateGateMetadata(C.UDP, uint16(peer.LocalAddr().(*net.UDPAddr).Port)))
	t.Cleanup(func() {
		conn.Close()
		peer.Close()
		lateGateWait(t, packet.dropped, "handler parent packet release")
		lateGateWait(t, conn.readDone, "handler parent reverse reader exit")
	})
	close(proxy.release)
	handleUDPConn(adapter)
	lateGateWait(t, conn.readStarted, "handler parent blocked reverse reader entry")
	lateGateWait(t, packet.dropped, "handler parent healthy request release")
	// Looking up the same actual NAT entry validates production wiring, not only a helper.
	sender, loaded := natTable.GetOrCreate(fmt.Sprintf("%d:%s", epoch, adapter.Key()), func() C.PacketSender { t.Error("handler NAT entry absent"); return newPacketSender() })
	if !loaded {
		t.Fatal("handler NAT entry was not reused")
	}
	s, ok := sender.(*packetSender)
	if !ok {
		t.Fatalf("unexpected sender %T", sender)
	}
	statistic.DefaultManager.StopRegistrations()
	if s.ctx.Err() != context.Canceled {
		t.Fatal("handler sender did not inherit registration cancellation while reverse reader blocked")
	}
	select {
	case <-conn.readDone:
		t.Fatal("reverse read exited before explicit socket cleanup")
	default:
	}
	late := &lateQueuePacket{}
	s.Send(late)
	if late.drops.Load() != 1 {
		t.Fatal("actual stopped handler sender admitted a late packet")
	}
}

// Signal only the call boundary; the wrapped sender is the actual upstream QUIC
// wrapper, not a fake timeout or a replacement sniff implementation.
type lateSniffSignal struct {
	C.PacketSender
	entered chan struct{}
	calls   atomic.Int32
	onSniff func() error
}

func (s *lateSniffSignal) DoSniff(m *C.Metadata) error {
	s.calls.Add(1)
	if s.entered != nil {
		close(s.entered)
	}
	if s.onSniff != nil {
		return s.onSniff()
	}
	return s.PacketSender.DoSniff(m)
}
func TestAngelaNexusLateTunnelQUICSniffCancellation(t *testing.T) {
	for _, mode := range []string{"empty-wait", "queued-reentrant-drop"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			base := newPacketSenderWithContext(ctx).(*packetSender)
			quic, err := S.NewQUICSniffer(S.SnifferConfig{})
			if err != nil {
				t.Fatal(err)
			}
			wrapped := quic.WrapperSender(base, func(*C.Metadata, string) { t.Error("incomplete QUIC replaced domain") })
			defer wrapped.Close()
			signal := &lateSniffSignal{PacketSender: wrapped, entered: make(chan struct{})}
			nested := &lateQueuePacket{}
			dropDone := make(chan struct{})
			queued := &lateQueuePacket{onDrop: func() { wrapped.Close(); base.Send(nested); close(dropDone) }}
			if mode == "queued-reentrant-drop" {
				base.Send(queued)
			}
			result := make(chan error, 1)
			go func() { result <- sniffUDPWithContext(ctx, signal, lateGateMetadata(C.UDP, 443)) }()
			lateGateWait(t, signal.entered, "real QUIC DoSniff entry")
			cancel()
			select {
			case err := <-result:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("sniff cancellation returned %v", err)
				}
			case <-time.After(time.Second):
				t.Fatal("canceled QUIC sniff still waits for its three-second timeout")
			}
			// Reentry may close q.done before the outer Drop callback returns.
			// Sniff cancellation is deliberately not a join of that callback.
			if mode == "queued-reentrant-drop" {
				lateGateWait(t, dropDone, "reentrant sniff queue Drop completion")
				if queued.drops.Load() != 1 || nested.drops.Load() != 1 {
					t.Fatalf("canceled sniff ownership: queued=%d nested=%d", queued.drops.Load(), nested.drops.Load())
				}
			}
			if len(base.ch) != 0 {
				t.Fatalf("canceled sniff retained %d packets", len(base.ch))
			}
			late := &lateQueuePacket{}
			wrapped.Send(late)
			if late.drops.Load() != 1 {
				t.Fatalf("late wrapped Send Drop calls=%d", late.drops.Load())
			}
		})
	}
}
func TestAngelaNexusLateTunnelQUICSniffFreshForwarding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	base := newPacketSenderWithContext(ctx).(*packetSender)
	quic, err := S.NewQUICSniffer(S.SnifferConfig{})
	if err != nil {
		t.Fatal(err)
	}
	wrapped := quic.WrapperSender(base, func(*C.Metadata, string) { t.Error("invalid QUIC replaced domain") })
	defer wrapped.Close()
	packet := &lateProcessPacket{metadata: lateGateMetadata(C.UDP, 443)}
	// A non-QUIC packet completes sniffing without a domain and still forwards.
	wrapped.Send(packet)
	if err := sniffUDPWithContext(ctx, wrapped, packet.metadata.Clone()); err != nil {
		t.Fatal(err)
	}
	conn := &lateProcessConn{onWrite: cancel}
	done := make(chan struct{})
	go func() { defer close(done); wrapped.Process(conn, nil) }()
	lateGateWait(t, done, "fresh wrapped sender Process exit")
	if conn.writes.Load() != 1 || packet.drops.Load() != 1 {
		t.Fatalf("fresh sniff blocked forwarding: writes=%d drops=%d", conn.writes.Load(), packet.drops.Load())
	}
}
func TestAngelaNexusLateTunnelSniffCancellationCheckpoint(t *testing.T) {
	for _, mode := range []string{"pre-canceled", "sniff-cancels-success", "sniff-cancels-error", "fresh-error"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			base := newPacketSenderWithContext(ctx)
			defer base.Close()
			sniffErr := errors.New("sniff failure control")
			signal := &lateSniffSignal{PacketSender: base, onSniff: func() error {
				if mode != "fresh-error" {
					cancel()
				}
				if mode == "sniff-cancels-error" || mode == "fresh-error" {
					return sniffErr
				}
				return nil
			}}
			if mode == "pre-canceled" {
				cancel()
			}
			err := sniffUDPWithContext(ctx, signal, lateGateMetadata(C.UDP, 443))
			want := error(context.Canceled)
			if mode == "fresh-error" {
				want = sniffErr
			}
			if !errors.Is(err, want) {
				t.Fatalf("sniff checkpoint returned %v, want %v", err, want)
			}
			if mode == "pre-canceled" && signal.calls.Load() != 0 {
				t.Fatal("pre-canceled setup entered sniff")
			}
		})
	}
}

// r30Conn deliberately records Close separately from the underlying close. In
// the normal case it closes the net.Pipe and wakes Read; in the ignore-wakeup
// case it models a reader which must be released by the test itself.
type r30Conn struct {
	net.Conn
	started   chan struct{}
	closed    chan struct{}
	once      sync.Once
	closeOnce sync.Once
	ignore    bool
	reentrant bool
}

func (c *r30Conn) Read(p []byte) (int, error) {
	c.once.Do(func() { close(c.started) })
	return c.Conn.Read(p)
}
func (c *r30Conn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	if c.reentrant {
		statistic.DefaultManager.StopRegistrations()
	}
	if c.ignore {
		return nil
	}
	return c.Conn.Close()
}

// Ignore deadlines so only Close (not a sniff timeout) can wake the blocked read.
func (c *r30Conn) SetReadDeadline(time.Time) error { return nil }

// r30Proxy is a real handler dial target: it counts dials and returns a real
// net.Pipe-backed C.Conn, so the positive test observes actual relay bytes.
type r30Proxy struct {
	C.Proxy
	dials  atomic.Int32
	remote C.Conn
	host   chan string
}

func (*r30Proxy) Name() string                  { return "round30-test-proxy" }
func (*r30Proxy) Type() C.AdapterType           { return C.Direct }
func (*r30Proxy) IsL3Protocol(*C.Metadata) bool { return false }
func (*r30Proxy) SupportUDP() bool              { return false }

type r30Remote struct{ N.ExtendedConn }

func (*r30Remote) NeedHandshake() bool           { return false }
func (*r30Remote) Chains() C.Chain               { return C.Chain{"round30-remote"} }
func (*r30Remote) ProviderChains() C.Chain       { return nil }
func (*r30Remote) AppendToChains(C.ProxyAdapter) {}
func (*r30Remote) RemoteDestination() string     { return "127.0.0.1:80" }

func (p *r30Proxy) DialContext(_ context.Context, metadata *C.Metadata) (C.Conn, error) {
	p.dials.Add(1)
	if p.host != nil {
		p.host <- metadata.SniffHost
	}
	if p.remote == nil {
		return nil, errors.New("round30: unexpected dial")
	}
	return p.remote, nil
}

func r30Dispatcher(t *testing.T) *S.Dispatcher {
	t.Helper()
	d, err := S.NewDispatcher(&S.Config{Enable: true, ParsePureIp: true, Sniffers: map[sniffer.Type]S.SnifferConfig{
		sniffer.HTTP: {}, sniffer.TLS: {},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func r30Wait(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for %s", what)
	}
}

// StopRegistrations must close the sniffing reader, not merely cancel a later
// dial. The real dispatcher has one-second sniff windows; this assertion is
// deliberately much shorter and therefore proves Close woke Read.
func TestAngelaNexusLateTunnelTCPSniffStopWakesRealSniff(t *testing.T) {
	old := snifferDispatcher
	oldEnabled := sniffingEnable
	snifferDispatcher, sniffingEnable = r30Dispatcher(t), true
	t.Cleanup(func() { snifferDispatcher, sniffingEnable = old, oldEnabled })
	statistic.DefaultManager.StartRegistrations()
	p := &r30Proxy{}
	lateGateSetup(t, &lateGateProxy{Proxy: p})
	in, peer := net.Pipe()
	t.Cleanup(func() { _ = in.Close(); _ = peer.Close() })
	c := &r30Conn{Conn: in, started: make(chan struct{}), closed: make(chan struct{}), reentrant: true}
	done := make(chan struct{})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(N.NewExtendedConn(c), lateGateMetadata(C.TCP, 80)))
	}()
	r30Wait(t, c.started, "real dispatcher Read")
	startedStop := time.Now()
	statistic.DefaultManager.StopRegistrations()
	r30Wait(t, c.closed, "sniff connection Close")
	r30Wait(t, done, "handler exit after cancellation")
	if elapsed := time.Since(startedStop); elapsed >= 500*time.Millisecond {
		t.Fatalf("cancellation took %s", elapsed)
	}
	if got := p.dials.Load(); got != 0 {
		t.Fatalf("canceled sniff dialed %d times", got)
	}
	_ = peer.Close()
}

// The pre-canceled generation must not even enter TCPSniff (and consequently
// must not call Read). This catches registering AfterFunc too late.
func TestAngelaNexusLateTunnelTCPSniffCanceledBeforeSniff(t *testing.T) {
	old := snifferDispatcher
	oldEnabled := sniffingEnable
	snifferDispatcher, sniffingEnable = r30Dispatcher(t), true
	t.Cleanup(func() { snifferDispatcher, sniffingEnable = old, oldEnabled })
	statistic.DefaultManager.StartRegistrations()
	p := &r30Proxy{}
	lateGateSetup(t, &lateGateProxy{Proxy: p})
	statistic.DefaultManager.StopRegistrations()
	in, peer := net.Pipe()
	t.Cleanup(func() { _ = in.Close(); _ = peer.Close() })
	c := &r30Conn{Conn: in, started: make(chan struct{}), closed: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(N.NewExtendedConn(c), lateGateMetadata(C.TCP, 80)))
	}()
	r30Wait(t, done, "pre-canceled handler exit")
	select {
	case <-c.started:
		t.Fatal("pre-canceled handler entered sniff Read")
	default:
	}
	if p.dials.Load() != 0 {
		t.Fatal("pre-canceled handler dialed")
	}
	_ = peer.Close()
}

// If a reader returns a complete HTTP request after cancellation despite Close,
// the post-TCPSniff ctx check must reject it before proxy dialing. This is the
// intentionally non-waking mode; the test releases Read manually.
type r30ResolutionRule struct {
	C.Rule
	calls atomic.Int32
}

func (r *r30ResolutionRule) Match(*C.Metadata, C.RuleMatchHelper) (bool, string) {
	r.calls.Add(1)
	return false, ""
}

func TestAngelaNexusLateTunnelTCPSniffCanceledSniffResultDoesNotDial(t *testing.T) {
	old := snifferDispatcher
	oldEnabled := sniffingEnable
	snifferDispatcher, sniffingEnable = r30Dispatcher(t), true
	t.Cleanup(func() { snifferDispatcher, sniffingEnable = old, oldEnabled })
	statistic.DefaultManager.StartRegistrations()
	in, peer := net.Pipe()
	t.Cleanup(func() { _ = in.Close(); _ = peer.Close() })
	c := &r30Conn{Conn: in, started: make(chan struct{}), closed: make(chan struct{}), ignore: true}
	p := &r30Proxy{}
	lateGateSetup(t, &lateGateProxy{Proxy: p})
	oldRules, oldSubRules, oldRuleProviders := rules, subRules, ruleProviders
	rule := &r30ResolutionRule{}
	UpdateRules([]C.Rule{rule}, nil, nil)
	SetMode(Rule)
	t.Cleanup(func() { UpdateRules(oldRules, oldSubRules, oldRuleProviders) })
	done := make(chan struct{})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(N.NewExtendedConn(c), lateGateMetadata(C.TCP, 80)))
	}()
	r30Wait(t, c.started, "non-waking sniff Read")
	statistic.DefaultManager.StopRegistrations()
	r30Wait(t, c.closed, "non-waking Close callback")
	go func() { _, _ = peer.Write([]byte("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n")) }()
	r30Wait(t, done, "post-sniff cancellation exit")
	if p.dials.Load() != 0 {
		t.Fatalf("canceled sniff result dialed %d times", p.dials.Load())
	}
	if rule.calls.Load() != 0 {
		t.Fatalf("canceled sniff continued metadata resolution: %d", rule.calls.Load())
	}
	_ = peer.Close()
	_ = in.Close()
}

// A normal HTTP request must be sniffed by the real HTTP/TLS dispatcher, then
// dialed and relayed. TLS is configured in the same dispatcher to ensure the
// production protocol set remains present without using a stub sniffer.
func TestAngelaNexusLateTunnelTCPSniffHTTPSniffAndRelay(t *testing.T) {
	old := snifferDispatcher
	oldEnabled := sniffingEnable
	snifferDispatcher, sniffingEnable = r30Dispatcher(t), true
	t.Cleanup(func() { snifferDispatcher, sniffingEnable = old, oldEnabled })
	statistic.DefaultManager.StartRegistrations()
	in, peer := net.Pipe()
	t.Cleanup(func() { _ = in.Close(); _ = peer.Close() })
	remote, remotePeer := net.Pipe()
	t.Cleanup(func() { _ = remote.Close(); _ = remotePeer.Close() })
	c := &r30Conn{Conn: in, started: make(chan struct{}), closed: make(chan struct{})}
	p := &r30Proxy{remote: &r30Remote{ExtendedConn: N.NewExtendedConn(remote)}, host: make(chan string, 1)}
	lateGateSetup(t, &lateGateProxy{Proxy: p})
	done := make(chan struct{})
	go func() {
		defer close(done)
		handleTCPConn(icontext.NewConnContext(N.NewExtendedConn(c), lateGateMetadata(C.TCP, 80)))
	}()
	request := []byte("GET /round30 HTTP/1.1\r\nHost: example.com\r\n\r\n")
	go func() { _, _ = peer.Write(request) }()
	got := make([]byte, len(request))
	_ = remotePeer.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(remotePeer, got); err != nil {
		t.Fatal(err)
	}
	if string(got) != string(request) {
		t.Fatalf("relayed request %q", got)
	}
	if p.dials.Load() != 1 {
		t.Fatalf("dials=%d, want 1", p.dials.Load())
	}
	if host := <-p.host; host != "example.com" {
		t.Fatalf("real sniff domain=%q", host)
	}
	_ = peer.Close()
	_ = remotePeer.Close()
	_ = remote.Close()
	r30Wait(t, done, "normal handler exit")
}

// r31Remote puts cancellation at actual handler callback boundaries. The write
// control deliberately returns success after cancellation without forwarding;
// cancellation cannot retroactively undo a write which already entered.
type r31Remote struct {
	*lateHandshakeConn
	onHandshake func()
	onWrite     func()
	handshake   bool
	entered     chan struct{}
	once        sync.Once
}

func (c *r31Remote) NeedHandshake() bool {
	if c.onHandshake != nil {
		c.onHandshake()
	}
	if c.entered != nil {
		c.once.Do(func() { close(c.entered) })
	}
	return c.handshake
}
func (c *r31Remote) Write(p []byte) (int, error) {
	if c.onWrite != nil {
		c.writes.Add(1)
		c.onWrite()
		return len(p), nil
	}
	return c.lateHandshakeConn.Write(p)
}
func r31Fixture(t *testing.T, payload []byte, remote *r31Remote) (*icontext.ConnContext, *r30Conn, net.Conn, <-chan struct{}) {
	t.Helper()
	local, peer := net.Pipe()
	inbound := &r30Conn{Conn: local, started: make(chan struct{}), closed: make(chan struct{}), reentrant: true}
	var conn net.Conn = inbound
	if len(payload) > 0 {
		br := bufio.NewReader(inbound)
		written := make(chan error, 1)
		go func() { _, err := peer.Write(payload); written <- err }()
		if _, err := br.Peek(len(payload)); err != nil {
			t.Fatal(err)
		}
		if err := <-written; err != nil {
			t.Fatal(err)
		}
		conn = N.WarpConnWithBioReader(inbound, br)
	}
	cc := icontext.NewConnContext(conn, lateGateMetadata(C.TCP, 9))
	proxy := &lateHandshakeProxy{conns: []C.Conn{remote}}
	lateGateSetup(t, &lateGateProxy{Proxy: proxy})
	done := make(chan struct{})
	t.Cleanup(func() {
		_ = peer.Close()
		_ = local.Close()
		_ = remote.Close()
		lateHandshakeWaitDone(t, done, "early handler exit")
	})
	go func() { defer close(done); handleTCPConn(cc) }()
	return cc, inbound, peer, done
}
func r31RemotePair(t *testing.T) (*r31Remote, net.Conn) {
	t.Helper()
	base, _, peer := lateHandshakeConnPair(t, nil, C.Chain{"early-checkpoint"})
	t.Cleanup(func() { _ = peer.Close() })
	return &r31Remote{lateHandshakeConn: base, handshake: true, entered: make(chan struct{})}, peer
}
func TestAngelaNexusLateTunnelEarlyHandshakeCancelWakesPeek(t *testing.T) {
	remote, _ := r31RemotePair(t)
	_, in, _, done := r31Fixture(t, nil, remote)
	r30Wait(t, in.started, "background peek Read entry")
	r30Wait(t, remote.entered, "early handshake waiting for peek")
	statistic.DefaultManager.StopRegistrations()
	r30Wait(t, in.closed, "setup cancellation inbound Close")
	lateHandshakeWaitDone(t, done, "canceled peek handler")
	if remote.writes.Load() != 0 {
		t.Fatalf("canceled peek wrote %d times", remote.writes.Load())
	}
	lateGateWaitSetups(t)
}
func TestAngelaNexusLateTunnelEarlyHandshakeCanceledBufferedData(t *testing.T) {
	payload := []byte("buffered-before-cancel")
	remote, _ := r31RemotePair(t)
	remote.onHandshake = func() { statistic.DefaultManager.StopRegistrations() }
	remote.onWrite = func() {} // expose any forbidden call without blocking a peer
	cc, _, _, done := r31Fixture(t, payload, remote)
	lateHandshakeWaitDone(t, done, "canceled buffered handler")
	if remote.writes.Load() != 0 || cc.Conn().Buffered() != len(payload) {
		t.Fatalf("canceled buffered data consumed: writes=%d buffered=%d", remote.writes.Load(), cc.Conn().Buffered())
	}
}
func TestAngelaNexusLateTunnelEarlyHandshakeCancelAfterWriteNoRelay(t *testing.T) {
	payload := []byte("late-successful-write")
	remote, _ := r31RemotePair(t)
	remote.onWrite = func() { statistic.DefaultManager.StopRegistrations() }
	cc, _, _, done := r31Fixture(t, payload, remote)
	lateHandshakeWaitDone(t, done, "late successful write handler")
	if remote.writes.Load() != 1 || cc.Conn().Buffered() != len(payload) {
		t.Fatalf("late successful write consumed inbound: writes=%d buffered=%d", remote.writes.Load(), cc.Conn().Buffered())
	}
}
func TestAngelaNexusLateTunnelEarlyHandshakeNoHandshakeCanceledResult(t *testing.T) {
	payload := []byte("no-handshake-canceled")
	remote, _ := r31RemotePair(t)
	remote.handshake = false
	remote.onHandshake = func() { statistic.DefaultManager.StopRegistrations() }
	cc, _, _, done := r31Fixture(t, payload, remote)
	lateHandshakeWaitDone(t, done, "no-handshake canceled result")
	if remote.writes.Load() != 0 || cc.Conn().Buffered() != len(payload) {
		t.Fatalf("canceled retry result entered relay: writes=%d buffered=%d", remote.writes.Load(), cc.Conn().Buffered())
	}
	r30Wait(t, remote.closed, "canceled retry result remote Close")
}
func TestAngelaNexusLateTunnelEarlyHandshakeSuccessUnregistersCancel(t *testing.T) {
	payload := []byte("early-success")
	remote, rp := r31RemotePair(t)
	_, in, ip, done := r31Fixture(t, payload, remote)
	_ = rp.SetReadDeadline(time.Now().Add(3 * time.Second))
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(rp, got); err != nil || string(got) != string(payload) {
		t.Fatalf("early success: %q %v", got, err)
	}
	// Reading early bytes alone does not prove Write returned or setup released.
	// A second actual relay exchange establishes the ownership transfer first.
	relay := []byte("relay-after-setup")
	go func() { _, _ = ip.Write(relay) }()
	got = make([]byte, len(relay))
	if _, err := io.ReadFull(rp, got); err != nil || string(got) != string(relay) {
		t.Fatalf("relay success: %q %v", got, err)
	}
	statistic.DefaultManager.StopRegistrations()
	lateGateWaitSetups(t)
	select {
	case <-in.closed:
		t.Fatal("setup cancellation callback remained armed")
	default:
	}
	select {
	case <-done:
		t.Fatal("setup-only stop joined relay")
	default:
	}
	// Continue real traffic after generation cancellation to prove no callback
	// closed an established relay; existing relay ownership remains separate.
	go func() { _, _ = ip.Write(relay) }()
	if _, err := io.ReadFull(rp, got); err != nil || string(got) != string(relay) {
		t.Fatalf("relay after stop: %q %v", got, err)
	}
}
