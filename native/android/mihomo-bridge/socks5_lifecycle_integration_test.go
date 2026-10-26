package outbound

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

	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/transport/socks5"
	"github.com/metacubex/mihomo/tunnel/statistic"
)

// Read can deliberately ignore Close, modeling a delayed control reader without
// sleeps or external network dependencies. Every test releases and joins it.
type socks5LifecycleControl struct {
	closeBlock <-chan struct{}
	net.Conn
	entered    chan struct{}
	release    chan struct{}
	closed     chan struct{}
	readOnce   sync.Once
	closeOnce  sync.Once
	closeCalls atomic.Int32
	failClose  atomic.Bool
}

func (c *socks5LifecycleControl) Read(p []byte) (int, error) {
	c.readOnce.Do(func() { close(c.entered) })
	<-c.release
	return 0, io.EOF
}
func (c *socks5LifecycleControl) Close() error {
	c.closeCalls.Add(1)
	c.closeOnce.Do(func() { close(c.closed) })
	if c.closeBlock != nil {
		<-c.closeBlock
	}
	if c.failClose.Load() {
		return errors.New("control close failed")
	}
	return nil
}

type socks5LifecyclePacket struct {
	net.PacketConn
	calls          atomic.Int32
	closed         chan struct{}
	closeOnce      sync.Once
	monitorEntered chan struct{}
	monitorRelease chan struct{}
	failClose      atomic.Bool
}

func (p *socks5LifecyclePacket) Close() error {
	call := p.calls.Add(1)
	p.closeOnce.Do(func() { close(p.closed) })
	if call == 1 && p.monitorEntered != nil {
		close(p.monitorEntered)
		<-p.monitorRelease
	}
	if p.failClose.Load() {
		return errors.New("packet close failed")
	}
	return net.ErrClosed // concurrent/repeated socket retirement is harmless
}
func socks5LifecycleFixture() (*socks5LifecycleControl, *socks5LifecyclePacket) {
	return &socks5LifecycleControl{entered: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}, &socks5LifecyclePacket{closed: make(chan struct{})}
}
func socks5LifecycleAwait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("lifecycle barrier timed out")
	}
}

func TestAngelaNexusSocks5CloseJoinsFinalMonitorCleanup(t *testing.T) {
	c, p := socks5LifecycleFixture()
	p.monitorEntered = make(chan struct{})
	p.monitorRelease = make(chan struct{})
	uc := newSocksPacketConn(p, c, nil)
	socks5LifecycleAwait(t, c.entered)
	close(c.release)
	socks5LifecycleAwait(t, p.monitorEntered)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	// Both raw sockets are already closable, but monitor cleanup is not done.
	if err := uc.closeWithContext(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("unjoined monitor reported success: %v", err)
	}
	close(p.monitorRelease)
	socks5LifecycleAwait(t, uc.monitorDone)
	if err := uc.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusSocks5TimeoutRetainsMonitorForRetry(t *testing.T) {
	c, p := socks5LifecycleFixture()
	uc := newSocksPacketConn(p, c, nil)
	socks5LifecycleAwait(t, c.entered)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	err := uc.closeWithContext(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("missing monitor drain timeout: %v", err)
	}
	if c.closeCalls.Load() == 0 || p.calls.Load() == 0 {
		t.Error("did not attempt both sockets")
	}
	close(c.release)
	socks5LifecycleAwait(t, uc.monitorDone)
	if err := uc.Close(); err != nil {
		t.Fatalf("retry lost monitor ownership: %v", err)
	}
}

func TestAngelaNexusSocks5CloseFailureStillAttemptsBothSockets(t *testing.T) {
	c, p := socks5LifecycleFixture()
	c.failClose.Store(true)
	p.failClose.Store(true)
	uc := newSocksPacketConn(p, c, nil)
	socks5LifecycleAwait(t, c.entered)
	err := uc.Close()
	if err == nil || c.closeCalls.Load() == 0 || p.calls.Load() == 0 {
		t.Errorf("lost close error or skipped socket: %v", err)
	}
	c.failClose.Store(false)
	p.failClose.Store(false)
	close(c.release)
	socks5LifecycleAwait(t, uc.monitorDone)
	if err := uc.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusSocks5ConcurrentCloseWithRealSockets(t *testing.T) {
	control, peer := net.Pipe()
	defer peer.Close()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	uc := newSocksPacketConn(pc, control, pc.LocalAddr())
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := uc.Close(); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	socks5LifecycleAwait(t, uc.monitorDone)
	if _, err := peer.Write([]byte("retired")); err == nil {
		t.Error("control peer still writable")
	}
	if _, err := pc.WriteTo([]byte("retired"), pc.LocalAddr()); !errors.Is(err, net.ErrClosed) {
		t.Errorf("UDP socket still open: %v", err)
	}
}

func TestAngelaNexusSocks5RemoteEOFClosesUDPAndJoins(t *testing.T) {
	control, peer := net.Pipe()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	uc := newSocksPacketConn(pc, control, pc.LocalAddr())
	_ = peer.Close()
	socks5LifecycleAwait(t, uc.monitorDone)
	if _, err := pc.WriteTo([]byte("retired"), pc.LocalAddr()); !errors.Is(err, net.ErrClosed) {
		t.Errorf("remote EOF retained UDP: %v", err)
	}
	if err := uc.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusSocks5ClosedOnlyRejectsMixedFailure(t *testing.T) {
	failure := errors.New("real socket cleanup failure")
	for _, err := range []error{failure, errors.Join(net.ErrClosed, failure), nil} {
		if socks5ClosedOnly(err) {
			t.Errorf("swallowed non-closed failure: %v", err)
		}
	}
	if !socks5ClosedOnly(errors.Join(net.ErrClosed, net.ErrClosed)) {
		t.Error("closed-only tree rejected")
	}
}

func TestAngelaNexusSocks5CompletedMonitorWinsCanceledWait(t *testing.T) {
	c, p := socks5LifecycleFixture()
	uc := newSocksPacketConn(p, c, nil)
	close(c.release)
	socks5LifecycleAwait(t, uc.monitorDone)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := uc.closeWithContext(ctx); err != nil {
		t.Errorf("completed monitor falsely retained cleanup debt: %v", err)
	}
}

// A shorter wait budget exercises the same closeWithContext used by Close,
// through the real packet wrappers and tracker, without a two-second test delay.
type socks5LifecycleShortClose struct{ *socksPacketConn }

func (p socks5LifecycleShortClose) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	return p.closeWithContext(ctx)
}
func TestAngelaNexusSocks5TrackerCloseRetainsTimeoutThenJoins(t *testing.T) {
	c, p := socks5LifecycleFixture()
	p.monitorEntered = make(chan struct{})
	p.monitorRelease = make(chan struct{})
	uc := newSocksPacketConn(p, c, nil)
	close(c.release)
	socks5LifecycleAwait(t, p.monitorEntered)
	manager := statistic.DefaultManager
	wrapped := NewPacketConn(socks5LifecycleShortClose{uc}, NewBase(BaseOption{Name: "socks5-lifecycle", Type: C.Socks5}))
	tracked := statistic.NewUDPTracker(wrapped, manager, &C.Metadata{NetWork: C.UDP}, nil, 0, 0, false)
	if err := tracked.Close(); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("tracker hid socket/monitor cleanup timeout: %v", err)
	}
	if manager.Get(tracked.ID()) == nil {
		t.Error("tracker lost timed-out cleanup ownership")
	}
	close(p.monitorRelease)
	socks5LifecycleAwait(t, uc.monitorDone)
	if err := tracked.Close(); err != nil {
		t.Fatal(err)
	}
	if manager.Get(tracked.ID()) != nil {
		t.Error("successful retry retained tracker")
	}
}

func TestAngelaNexusSocks5BlockedRawCloseIsBoundedAndOwned(t *testing.T) {
	for _, blocked := range []string{"tcp", "udp"} {
		t.Run(blocked, func(t *testing.T) {
			c, p := socks5LifecycleFixture()
			release := make(chan struct{})
			if blocked == "tcp" {
				c.closeBlock = release
			} else {
				p.monitorEntered = make(chan struct{})
				p.monitorRelease = release
			}
			uc := newSocksPacketConn(p, c, nil)
			socks5LifecycleAwait(t, c.entered)
			ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
			defer cancel()
			if err := uc.closeWithContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
				t.Errorf("blocked raw %s Close not bounded: %v", blocked, err)
			}
			socks5LifecycleAwait(t, c.closed)
			socks5LifecycleAwait(t, p.closed)
			if blocked == "udp" {
				socks5LifecycleAwait(t, p.monitorEntered)
			}
			attempt := uc.beginSocketClose()
			for i := 0; i < 16; i++ {
				if err := uc.closeWithContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
					t.Errorf("retry hid blocked close: %v", err)
				}
				if uc.beginSocketClose() != attempt {
					t.Error("retry abandoned in-flight raw close owner")
				}
			}
			if c.closeCalls.Load() != 1 || p.calls.Load() != 1 {
				t.Errorf("blocked raw close skipped peer or duplicated workers: tcp=%d udp=%d", c.closeCalls.Load(), p.calls.Load())
			}
			close(release)
			close(c.release)
			socks5LifecycleAwait(t, uc.monitorDone)
			if err := uc.Close(); err != nil {
				t.Fatalf("completed raw-close retry failed: %v", err)
			}
		})
	}
}

type socks5LifecycleDialer struct {
	control net.Conn
	packet  net.PacketConn
}

func (d socks5LifecycleDialer) DialContext(context.Context, string, string) (net.Conn, error) {
	return d.control, nil
}
func (d socks5LifecycleDialer) ListenPacket(context.Context, string, string, netip.AddrPort) (net.PacketConn, error) {
	return d.packet, nil
}

type socks5LifecycleServerConn struct{ net.Conn }

func (c socks5LifecycleServerConn) LocalAddr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 1080}
}
func TestAngelaNexusSocks5ListenPacketProductionPathJoins(t *testing.T) {
	control, peer := net.Pipe()
	defer control.Close()
	defer peer.Close()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serverDone := make(chan error, 1)
	go func() {
		_, command, _, err := socks5.ServerHandshake(socks5LifecycleServerConn{peer}, nil)
		if err == nil && command != socks5.CmdUDPAssociate {
			err = errors.New("not UDP ASSOCIATE")
		}
		if err == nil {
			_, err = io.Copy(io.Discard, peer)
		}
		serverDone <- err
	}()
	ss, err := NewSocks5(Socks5Option{BasicOption: BasicOption{DialerForAPI: socks5LifecycleDialer{control, pc}}, Name: "socks5-production", Server: "127.0.0.1", Port: 1080, UDP: true})
	if err != nil {
		t.Fatal(err)
	}
	metadata := &C.Metadata{NetWork: C.UDP, DstIP: netip.MustParseAddr("127.0.0.1"), DstPort: 53}
	association, err := ss.ListenPacketContext(ctx, metadata)
	if err != nil {
		t.Fatal(err)
	}
	var monitor *socksPacketConn
	var current any = association
	for i := 0; i < 12; i++ {
		if candidate, ok := current.(*socksPacketConn); ok {
			monitor = candidate
			break
		}
		upstream, ok := current.(interface{ Upstream() any })
		if !ok {
			break
		}
		current = upstream.Upstream()
	}
	if monitor == nil || monitor.monitorDone == nil {
		t.Fatal("production association has no monitor completion owner")
	}
	tracked := statistic.NewUDPTracker(association, statistic.DefaultManager, metadata, nil, 0, 0, false)
	if err := tracked.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-monitor.monitorDone:
	default:
		t.Error("production tracker Close returned with live monitor")
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
	if statistic.DefaultManager.Get(tracked.ID()) != nil {
		t.Error("closed production tracker retained")
	}
}
