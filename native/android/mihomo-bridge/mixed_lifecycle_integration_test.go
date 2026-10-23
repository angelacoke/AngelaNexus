package mixed

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter/inbound"
	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/tunnel"
)

type angelanexusListenConfig struct {
	C.InboundListenConfig
	listener net.Listener
}

func (c angelanexusListenConfig) Listen(context.Context, string, string) (net.Listener, error) {
	return c.listener, nil
}

type angelanexusAddr string

func (a angelanexusAddr) Network() string { return "tcp" }
func (a angelanexusAddr) String() string  { return string(a) }

type angelanexusConn struct {
	net.Conn
	remote    net.Addr
	closeMu   sync.Mutex
	closeErrs []error
	closed    chan struct{}
}

func (c *angelanexusConn) RemoteAddr() net.Addr { return c.remote }
func (c *angelanexusConn) Close() error {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	var err error
	if len(c.closeErrs) != 0 {
		err, c.closeErrs = c.closeErrs[0], c.closeErrs[1:]
	}
	if c.closed != nil {
		select {
		case <-c.closed:
		default:
			close(c.closed)
		}
	}
	if err != nil {
		return err
	}
	return c.Conn.Close()
}

func angelanexusPipe(t *testing.T) (net.Conn, *angelanexusConn) {
	t.Helper()
	a, b := net.Pipe()
	return a, &angelanexusConn{Conn: b, remote: angelanexusAddr("127.0.0.1:1"), closed: make(chan struct{})}
}

type angelanexusListener struct {
	mu            sync.Mutex
	acceptEntered chan struct{}
	acceptRelease chan net.Conn
	closed        chan struct{}
	closeErrs     []error
	addr          net.Addr
	late          bool
	releaseClosed bool
}

func newAngelanexusListener() *angelanexusListener {
	return &angelanexusListener{acceptEntered: make(chan struct{}), acceptRelease: make(chan net.Conn, 2), closed: make(chan struct{}), addr: angelanexusAddr("127.0.0.1:0")}
}
func (l *angelanexusListener) Accept() (net.Conn, error) {
	select {
	case <-l.acceptEntered:
	default:
		close(l.acceptEntered)
	}
	c, ok := <-l.acceptRelease
	if !ok {
		return nil, net.ErrClosed
	}
	return c, nil
}
func (l *angelanexusListener) Close() error {
	l.mu.Lock()
	var err error
	if len(l.closeErrs) != 0 {
		err, l.closeErrs = l.closeErrs[0], l.closeErrs[1:]
	}
	select {
	case <-l.closed:
	default:
		close(l.closed)
	}
	if !l.late && !l.releaseClosed {
		close(l.acceptRelease)
		l.releaseClosed = true
	}
	l.mu.Unlock()
	return err
}
func (l *angelanexusListener) Addr() net.Addr { return l.addr }

func (l *angelanexusListener) finishAccepts() {
	l.mu.Lock()
	if !l.releaseClosed {
		close(l.acceptRelease)
		l.releaseClosed = true
	}
	l.mu.Unlock()
}

func angelanexusNew(t *testing.T, n net.Listener) *Listener {
	t.Helper()
	l, err := NewWithConfig(LC.AuthServer{Enable: true, Listen: n.Addr().String()}, angelanexusListenConfig{listener: n}, tunnel.Tunnel, inbound.WithInName("ANGELANEXUS-TEST"))
	if err != nil {
		t.Fatal(err)
	}
	registerListener(l)
	return l
}
func angelanexusWait(t *testing.T, l *Listener) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.WaitClosed(ctx); err != nil {
		t.Fatal(err)
	}
}
func angelanexusCleanup(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = StopListeners(ctx)
}

// A real accepted connection must have entered Read before stop; merely
// completing Dial can leave it in the kernel backlog, which may reset on close.
type angelanexusReadListener struct {
	net.Listener
	entered chan struct{}
	once    sync.Once
}
type angelanexusReadConn struct {
	net.Conn
	owner *angelanexusReadListener
}

func (l *angelanexusReadListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &angelanexusReadConn{Conn: c, owner: l}, nil
}
func (c *angelanexusReadConn) Read(p []byte) (int, error) {
	c.owner.once.Do(func() { close(c.owner.entered) })
	return c.Conn.Read(p)
}

func TestAngelaNexusMixedRealTCPNoFirstBytePeerEOF(t *testing.T) {
	n, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	observer := &angelanexusReadListener{Listener: n, entered: make(chan struct{})}
	l := angelanexusNew(t, observer)
	defer angelanexusCleanup(t)
	peer, err := net.Dial("tcp", n.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer peer.Close()
	select {
	case <-observer.entered:
	case <-time.After(time.Second):
		t.Fatal("real mixed first-byte Read did not start")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	angelanexusWait(t, l)
	_ = peer.SetReadDeadline(time.Now().Add(time.Second))
	var b [1]byte
	if _, err := peer.Read(b[:]); err != io.EOF {
		t.Fatalf("peer error=%v, want EOF", err)
	}
}

func TestAngelaNexusMixedLateAcceptAfterCloseIsClosed(t *testing.T) {
	n := newAngelanexusListener()
	n.late = true
	l := angelanexusNew(t, n)
	defer angelanexusCleanup(t)
	<-n.acceptEntered
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	server, peer := angelanexusPipe(t)
	n.acceptRelease <- server
	n.finishAccepts()
	_ = peer.SetReadDeadline(time.Now().Add(time.Second))
	var b [1]byte
	if _, err := peer.Read(b[:]); err != io.EOF {
		t.Fatalf("late peer error=%v, want EOF", err)
	}
	peer.Close()
	angelanexusWait(t, l)
}

func TestAngelaNexusMixedLateConnCloseFailureRetainedAndRetried(t *testing.T) {
	n := newAngelanexusListener()
	n.late = true
	l := angelanexusNew(t, n)
	defer angelanexusCleanup(t)
	<-n.acceptEntered
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	server, peer := angelanexusPipe(t)
	server = &angelanexusConn{Conn: server, remote: angelanexusAddr("127.0.0.1:1"), closeErrs: []error{errors.New("late close failed")}, closed: make(chan struct{})}
	n.acceptRelease <- server
	n.finishAccepts()
	<-server.(*angelanexusConn).closed
	if err := peer.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	var b [1]byte
	_, _ = peer.Read(b[:])
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := l.WaitClosed(ctx); err == nil {
		t.Fatal("wait unexpectedly acknowledged failed late close")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	angelanexusWait(t, l)
	_ = peer.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := peer.Read(b[:]); err != io.EOF {
		t.Fatalf("retried late peer error=%v, want EOF", err)
	}
	peer.Close()
}

func TestAngelaNexusMixedListenerCloseErrorAfterActualCloseRetry(t *testing.T) {
	n := newAngelanexusListener()
	n.closeErrs = []error{errors.New("ack failed"), net.ErrClosed}
	l := angelanexusNew(t, n)
	defer angelanexusCleanup(t)
	<-n.acceptEntered
	if err := l.Close(); err == nil || err.Error() != "ack failed" {
		t.Fatalf("first close=%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := l.WaitClosed(ctx); err == nil {
		t.Fatal("wait unexpectedly acknowledged listener close debt")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	angelanexusWait(t, l)
}

func TestAngelaNexusMixedJoinedClosedAndRealErrorNotSwallowed(t *testing.T) {
	realErr := errors.New("real close failure")
	n := newAngelanexusListener()
	n.closeErrs = []error{errors.Join(net.ErrClosed, realErr), net.ErrClosed}
	l := angelanexusNew(t, n)
	defer angelanexusCleanup(t)
	<-n.acceptEntered
	if err := l.Close(); err == nil || !errors.Is(err, realErr) {
		t.Fatalf("joined close=%v", err)
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	angelanexusWait(t, l)
}

type angelanexusBlockingConn struct {
	net.Conn
	remote  net.Addr
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (c *angelanexusBlockingConn) RemoteAddr() net.Addr { return c.remote }
func (c *angelanexusBlockingConn) Read(p []byte) (int, error) {
	c.once.Do(func() { close(c.entered) })
	<-c.release
	return 0, io.EOF
}

func TestAngelaNexusMixedBlockedHandlerWaitRetainsOwnerThenRetryRemoves(t *testing.T) {
	n := newAngelanexusListener()
	l := angelanexusNew(t, n)
	server, peer := angelanexusPipe(t)
	_ = peer
	bc := &angelanexusBlockingConn{Conn: server, remote: angelanexusAddr("127.0.0.1:1"), entered: make(chan struct{}), release: make(chan struct{})}
	n.acceptRelease <- bc
	<-bc.entered
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := StopListeners(ctx); err == nil {
		t.Fatal("blocked handler stop unexpectedly succeeded")
	}
	listenerRegistry.Lock()
	_, owned := listenerRegistry.generations[l]
	listenerRegistry.Unlock()
	if !owned {
		t.Fatal("timed-out listener was removed from registry")
	}
	close(bc.release)
	if err := StopListeners(context.Background()); err != nil {
		t.Fatal(err)
	}
	listenerRegistry.Lock()
	_, owned = listenerRegistry.generations[l]
	listenerRegistry.Unlock()
	if owned {
		t.Fatal("drained listener remained in registry")
	}
	peer.Close()
}

func TestAngelaNexusMixedStopCancelsAllGenerationsBeforeJoin(t *testing.T) {
	first, second := newAngelanexusListener(), newAngelanexusListener()
	first.late, second.late = true, true
	angelanexusNew(t, first)
	angelanexusNew(t, second)
	defer angelanexusCleanup(t)
	defer first.finishAccepts()
	defer second.finishAccepts()
	<-first.acceptEntered
	<-second.acceptEntered
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stopped := make(chan error, 1)
	go func() { stopped <- StopListeners(ctx) }()
	// Neither accept loop can exit until released. Sequential Close+Wait
	// cannot cancel the other generation before the shared deadline here.
	for _, n := range []*angelanexusListener{first, second} {
		select {
		case <-n.closed:
		case <-ctx.Done():
			t.Fatal("not all generations canceled before joining")
		}
	}
	first.finishAccepts()
	second.finishAccepts()
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
}
