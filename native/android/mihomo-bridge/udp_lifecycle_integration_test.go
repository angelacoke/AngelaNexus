package socks

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter/inbound"
	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/transport/socks5"
)

type angelaListenConfig struct {
	C.InboundListenConfig
	pc net.PacketConn
}

func (c angelaListenConfig) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	return c.pc, nil
}

type angelaTunnel struct {
	got     chan C.UDPPacket
	entered chan struct{}
	release chan struct{}
}

func (*angelaTunnel) HandleTCPConn(net.Conn, *C.Metadata) {}
func (t *angelaTunnel) HandleUDPPacket(p C.UDPPacket, _ *C.Metadata) {
	select {
	case t.got <- p:
	default:
	}
	select {
	case <-t.entered:
	default:
		close(t.entered)
	}
	if t.release != nil {
		<-t.release
	}
}
func (*angelaTunnel) NatTable() C.NatTable { return nil }

func angelaWire(t *testing.T, body string) []byte {
	t.Helper()
	b, err := socks5.EncodeUDPPacket(socks5.ParseAddrToSocksAddr(&net.UDPAddr{IP: net.ParseIP("1.1.1.1"), Port: 53}), []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAngelaNexusMixedUDPRealSocketHeldPacketDrop(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{}), release: make(chan struct{})}
	l, err := NewMixedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, angelaListenConfig{pc: pc}, tr)
	if err != nil {
		t.Fatal(err)
	}
	peer, err := net.Dial("udp", pc.LocalAddr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	if _, err = peer.Write(angelaWire(t, "held")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-tr.entered:
	case <-time.After(time.Second):
		t.Fatal("handler did not receive packet")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	err = StopMixedUDP(ctx)
	cancel()
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stop error=%v, want deadline while handler holds packet", err)
	}
	p := <-tr.got
	close(tr.release)
	p.Drop()
	p.Drop()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	if err := StopMixedUDP(ctx); err != nil {
		t.Fatal(err)
	}
	cancel()
	if _, err := p.WriteBack([]byte("late"), peer.LocalAddr()); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("late WriteBack=%v", err)
	}
	if !l.IsClosed() {
		t.Fatal("listener not closed")
	}
}

func TestAngelaNexusMixedUDPHandlePutExactlyOnce(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	l := &UDPListener{packetConn: pc, mixed: true, pending: 1}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{}), release: make(chan struct{})}
	close(tr.release)
	var puts atomic.Int32
	handleMixedSocksUDP(l, tr, angelaWire(t, "once"), func() { puts.Add(1) }, &net.UDPAddr{}, inbound.WithInName("test"))
	p := <-tr.got
	p.Drop()
	p.Drop()
	if got := puts.Load(); got != 1 {
		t.Fatalf("put calls=%d, want 1", got)
	}
	l.mu.Lock()
	pending := l.pending
	l.mu.Unlock()
	if pending != 0 {
		t.Fatalf("pending=%d", pending)
	}
}

func TestAngelaNexusMixedUDPOnlyClosedErrorJoin(t *testing.T) {
	if onlyClosedError(errors.Join(net.ErrClosed, errors.New("other"))) {
		t.Fatal("joined non-closed error was swallowed")
	}
	if !onlyClosedError(errors.Join(net.ErrClosed, net.ErrClosed)) {
		t.Fatal("joined closed errors were not recognized")
	}
}

type angelaClosePC struct {
	net.PacketConn
	mu    sync.Mutex
	calls int
}

func (c *angelaClosePC) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	if c.calls == 1 {
		return errors.New("reported close failure after fd release")
	}
	return net.ErrClosed
}
func (c *angelaClosePC) count() int { c.mu.Lock(); defer c.mu.Unlock(); return c.calls }
func TestAngelaNexusMixedUDPCloseFailureRetriesAndIsIdempotent(t *testing.T) {
	pc := &angelaClosePC{PacketConn: fakeAngelaPC{}}
	l := &UDPListener{packetConn: pc, mixed: true, drained: make(chan struct{})}
	if err := l.Close(); err == nil {
		t.Fatal("first close unexpectedly succeeded")
	}
	if err := l.Close(); err != nil {
		t.Fatalf("retry close=%v", err)
	}
	if err := l.Close(); err != nil {
		t.Fatalf("acknowledged close=%v", err)
	}
	if got := pc.count(); got != 2 {
		t.Fatalf("Close calls=%d, want 2", got)
	}
}

type fakeAngelaPC struct{}

func (fakeAngelaPC) ReadFrom([]byte) (int, net.Addr, error) { return 0, nil, net.ErrClosed }
func (fakeAngelaPC) WriteTo([]byte, net.Addr) (int, error)  { return 0, net.ErrClosed }
func (fakeAngelaPC) Close() error                           { return nil }
func (fakeAngelaPC) LocalAddr() net.Addr                    { return &net.UDPAddr{} }
func (fakeAngelaPC) SetDeadline(time.Time) error            { return nil }
func (fakeAngelaPC) SetReadDeadline(time.Time) error        { return nil }
func (fakeAngelaPC) SetWriteDeadline(time.Time) error       { return nil }

type angelaLateEnhance struct {
	fakeAngelaPC
	ready    chan struct{}
	returned chan struct{}
	calls    int32
}

func (c *angelaLateEnhance) WaitReadFrom() ([]byte, func(), net.Addr, error) {
	if atomic.AddInt32(&c.calls, 1) > 1 {
		return nil, nil, nil, net.ErrClosed
	}
	<-c.ready
	close(c.returned)
	return []byte("late"), func() { atomic.AddInt32(&angelaLatePuts, 1) }, &net.UDPAddr{}, nil
}

var angelaLatePuts int32

func TestAngelaNexusMixedUDPLateSuccessfulReadAfterStopIsReturned(t *testing.T) {
	atomic.StoreInt32(&angelaLatePuts, 0)
	c := &angelaLateEnhance{ready: make(chan struct{}), returned: make(chan struct{})}
	l := &UDPListener{packetConn: c, mixed: true, drained: make(chan struct{})}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{}), release: make(chan struct{})}
	close(tr.release)
	done := make(chan struct{})
	go func() { l.readLoop(c, tr); close(done) }()
	l.mu.Lock()
	l.closed = true
	l.mu.Unlock()
	close(c.ready)
	select {
	case <-c.returned:
	case <-time.After(time.Second):
		t.Fatal("read did not return")
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("read loop did not stop")
	}
	if atomic.LoadInt32(&angelaLatePuts) != 1 {
		t.Fatalf("late put count=%d", angelaLatePuts)
	}
	select {
	case <-tr.got:
		t.Fatal("late packet was delivered")
	default:
	}
}

type angelaBlockingClosePC struct {
	fakeAngelaPC
	entered chan struct{}
	release chan struct{}
	calls   int32
}

func (c *angelaBlockingClosePC) Close() error {
	if atomic.AddInt32(&c.calls, 1) > 1 {
		return net.ErrClosed
	}
	select {
	case <-c.entered:
	default:
		close(c.entered)
	}
	<-c.release
	return errors.New("old generation close failed")
}

func TestAngelaNexusMixedUDPSnapshotDoesNotCloseNewGeneration(t *testing.T) {
	oldPC := &angelaBlockingClosePC{entered: make(chan struct{}), release: make(chan struct{})}
	old := &UDPListener{packetConn: oldPC, mixed: true, drained: make(chan struct{})}
	close(old.drained)
	registerUDPMixed(old)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	result := make(chan error, 1)
	go func() { result <- StopMixedUDP(ctx) }()
	select {
	case <-oldPC.entered:
	case <-time.After(time.Second):
		cancel()
		t.Fatal("old generation was not closed")
	}
	newPC := &angelaClosePC{PacketConn: fakeAngelaPC{}}
	new := &UDPListener{packetConn: newPC, mixed: true, drained: make(chan struct{})}
	close(new.drained)
	registerUDPMixed(new)
	close(oldPC.release)
	if err := <-result; err == nil {
		t.Fatal("failed old generation was not reported")
	}
	cancel()
	if got := newPC.count(); got != 0 {
		t.Fatalf("new generation Close calls=%d, want 0", got)
	}
	// The first close is reserved for the next snapshot; make this fake's
	// second call the successful net.ErrClosed acknowledgement.
	newPC.mu.Lock()
	newPC.calls = 1
	newPC.mu.Unlock()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	if err := StopMixedUDP(ctx); err != nil {
		t.Fatal(err)
	}
	cancel()
}
