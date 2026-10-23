package dns

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	D "github.com/miekg/dns"
)

type angelaDNSServiceFunc func(context.Context, *D.Msg) (*D.Msg, error)

func (f angelaDNSServiceFunc) ServeMsg(ctx context.Context, msg *D.Msg) (*D.Msg, error) {
	return f(ctx, msg)
}
func angelaDNSAnswer(_ context.Context, msg *D.Msg) (*D.Msg, error) {
	answer := new(D.Msg)
	answer.SetReply(msg)
	answer.Answer = []D.RR{&D.A{Hdr: D.RR_Header{Name: msg.Question[0].Name, Rrtype: D.TypeA, Class: D.ClassINET, Ttl: 1}, A: net.IPv4(192, 0, 2, 7)}}
	return answer, nil
}

type angelaDNSListenConfig struct{ net.ListenConfig }

func angelaDNSFreeAddress(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	p, err := net.ListenPacket("udp", addr)
	if err != nil {
		_ = l.Close()
		t.Fatal(err)
	}
	_ = p.Close()
	_ = l.Close()
	return addr
}
func angelaDNSWait(t *testing.T, ch <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for " + label)
	}
}
func angelaDNSStop(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := StopServer(ctx); err != nil {
		t.Fatal(err)
	}
}
func angelaDNSQuery(t *testing.T, addr, network string) {
	t.Helper()
	q := new(D.Msg)
	q.SetQuestion("generation.angelanexus.test.", D.TypeA)
	deadline := time.Now().Add(3 * time.Second)
	for {
		answer, _, err := (&D.Client{Net: network, Timeout: 50 * time.Millisecond}).Exchange(q, addr)
		if err == nil && answer != nil && len(answer.Answer) == 1 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s query failed: %v / %v", network, answer, err)
		}
		time.Sleep(time.Millisecond)
	}
}
func angelaDNSRebind(t *testing.T, addr string) {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("TCP listener survived successful stop: %v", err)
	}
	defer l.Close()
	p, err := net.ListenPacket("udp", addr)
	if err != nil {
		t.Fatalf("UDP listener survived successful stop: %v", err)
	}
	_ = p.Close()
}

func TestAngelaNexusDNSServerRealTCPUDPAndRestart(t *testing.T) {
	t.Cleanup(func() { angelaDNSStop(t) })
	addr := angelaDNSFreeAddress(t)
	for generation := 0; generation < 2; generation++ {
		ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(angelaDNSAnswer))
		angelaDNSQuery(t, addr, "udp")
		angelaDNSQuery(t, addr, "tcp")
		angelaDNSStop(t)
		angelaDNSRebind(t, addr)
	}
}

// Each Listen intentionally ignores cancellation until release. The resources
// arrive after stop has already taken its snapshot; neither may lose its owner.
type angelaDNSLateListen struct {
	entered       chan struct{}
	canceled      chan struct{}
	release       chan struct{}
	closed        chan struct{}
	failClose     atomic.Bool
	closeAttempts atomic.Int32
	blockClose    <-chan struct{}
	closeEntered  chan struct{}
}

func newAngelaDNSLateListen() *angelaDNSLateListen {
	return &angelaDNSLateListen{entered: make(chan struct{}, 2), canceled: make(chan struct{}, 2), release: make(chan struct{}), closed: make(chan struct{}, 2), closeEntered: make(chan struct{}, 2)}
}
func (l *angelaDNSLateListen) wait(ctx context.Context) {
	l.entered <- struct{}{}
	<-ctx.Done()
	l.canceled <- struct{}{}
	<-l.release
}

var errAngelaDNSClose = errors.New("injected DNS resource close failure")

func (l *angelaDNSLateListen) close(closeResource func() error, once *sync.Once) error {
	l.closeAttempts.Add(1)
	select {
	case l.closeEntered <- struct{}{}:
	default:
	}
	if l.blockClose != nil {
		<-l.blockClose
	}
	if l.failClose.Load() {
		return errors.Join(net.ErrClosed, errAngelaDNSClose)
	}
	err := closeResource()
	if err == nil || errors.Is(err, net.ErrClosed) {
		once.Do(func() { l.closed <- struct{}{} })
	}
	return err
}

type angelaDNSLateTCP struct {
	net.Listener
	owner *angelaDNSLateListen
	once  sync.Once
}

func (l *angelaDNSLateTCP) Close() error { return l.owner.close(l.Listener.Close, &l.once) }

type angelaDNSLateUDP struct {
	net.PacketConn
	owner *angelaDNSLateListen
	once  sync.Once
}

func (p *angelaDNSLateUDP) Close() error { return p.owner.close(p.PacketConn.Close, &p.once) }
func (l *angelaDNSLateListen) Listen(ctx context.Context, _, _ string) (net.Listener, error) {
	l.wait(ctx)
	resource, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	return &angelaDNSLateTCP{Listener: resource, owner: l}, nil
}
func (l *angelaDNSLateListen) ListenPacket(ctx context.Context, _, _ string) (net.PacketConn, error) {
	l.wait(ctx)
	resource, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	return &angelaDNSLateUDP{PacketConn: resource, owner: l}, nil
}
func angelaDNSLateStart(t *testing.T) (*angelaDNSLateListen, func()) {
	t.Helper()
	lc := newAngelaDNSLateListen()
	var once sync.Once
	release := func() { once.Do(func() { close(lc.release) }) }
	t.Cleanup(func() { lc.failClose.Store(false); release(); angelaDNSStop(t) })
	ReCreateServer("127.0.0.1:5353", lc, angelaDNSServiceFunc(angelaDNSAnswer))
	angelaDNSWait(t, lc.entered, "TCP/UDP listen entry")
	angelaDNSWait(t, lc.entered, "second listen entry")
	return lc, release
}
func TestAngelaNexusDNSServerLateListenTimeoutRetry(t *testing.T) {
	lc, release := angelaDNSLateStart(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := StopServer(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unjoined late listen reported successful stop: %v", err)
	}
	angelaDNSWait(t, lc.canceled, "listen context cancellation")
	angelaDNSWait(t, lc.canceled, "second listen context cancellation")
	release()
	angelaDNSStop(t)
	angelaDNSWait(t, lc.closed, "late socket cleanup")
	angelaDNSWait(t, lc.closed, "second late socket cleanup")
}
func TestAngelaNexusDNSServerBlockedCloseRespectsDeadlineAndDoesNotHoldGlobalLock(t *testing.T) {
	lc, release := angelaDNSLateStart(t)
	closeRelease := make(chan struct{})
	lc.blockClose = closeRelease
	var once sync.Once
	t.Cleanup(func() { once.Do(func() { close(closeRelease) }) })
	stopped := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
		defer cancel()
		stopped <- StopServer(ctx)
	}()
	angelaDNSWait(t, lc.canceled, "blocked-close cancellation")
	release()
	angelaDNSWait(t, lc.closeEntered, "first blocking Close")
	angelaDNSWait(t, lc.closeEntered, "second blocking Close")
	select {
	case err := <-stopped:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("blocked Close was reported clean: %v", err)
		}
	case <-time.After(time.Second):
		once.Do(func() { close(closeRelease) })
		t.Fatal("blocked Close exceeded stop context")
	}
	addr := angelaDNSFreeAddress(t)
	recreated := make(chan struct{})
	go func() {
		ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(angelaDNSAnswer))
		close(recreated)
	}()
	angelaDNSWait(t, recreated, "Close must not hold DNS control lock")
	angelaDNSQuery(t, addr, "tcp")
	once.Do(func() { close(closeRelease) })
	angelaDNSStop(t)
	angelaDNSWait(t, lc.closed, "first blocked Close completion")
	angelaDNSWait(t, lc.closed, "second blocked Close completion")
}
func TestAngelaNexusDNSServerConcurrentStopCannotForgetPendingGeneration(t *testing.T) {
	lc, release := angelaDNSLateStart(t)
	first := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		first <- StopServer(ctx)
	}()
	angelaDNSWait(t, lc.canceled, "first stop cancellation")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := StopServer(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("concurrent stop forgot owned pending generation: %v", err)
	}
	release()
	select {
	case err := <-first:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("first stop did not drain")
	}
	angelaDNSWait(t, lc.closed, "late TCP/UDP cleanup")
	angelaDNSWait(t, lc.closed, "second late cleanup")
}
func TestAngelaNexusDNSServerLateCloseFailureRetainsOwner(t *testing.T) {
	lc, release := angelaDNSLateStart(t)
	lc.failClose.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	_ = StopServer(ctx)
	cancel()
	release()
	ctx, cancel = context.WithTimeout(context.Background(), 200*time.Millisecond)
	err := StopServer(ctx)
	cancel()
	if err == nil || lc.closeAttempts.Load() == 0 {
		t.Fatalf("late resource close failure lost ownership: err=%v attempts=%d", err, lc.closeAttempts.Load())
	}
	lc.failClose.Store(false)
	angelaDNSStop(t)
	angelaDNSWait(t, lc.closed, "retry closes first retained socket")
	angelaDNSWait(t, lc.closed, "retry closes second retained socket")
}
func TestAngelaNexusDNSServerOldStopCannotCloseNewGeneration(t *testing.T) {
	lc, release := angelaDNSLateStart(t)
	first := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		first <- StopServer(ctx)
	}()
	angelaDNSWait(t, lc.canceled, "retiring generation cancellation")
	addr := angelaDNSFreeAddress(t)
	ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(angelaDNSAnswer))
	angelaDNSQuery(t, addr, "tcp")
	angelaDNSQuery(t, addr, "udp")
	release()
	select {
	case err := <-first:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("old stop failed to finish")
	}
	angelaDNSWait(t, lc.closed, "old generation resource close")
	angelaDNSWait(t, lc.closed, "second old generation resource close")
	angelaDNSQuery(t, addr, "tcp")
	angelaDNSQuery(t, addr, "udp")
}
func TestAngelaNexusDNSServerRecreateDoesNotWaitForUncooperativeListen(t *testing.T) {
	_, release := angelaDNSLateStart(t)
	addr := angelaDNSFreeAddress(t)
	recreated := make(chan struct{})
	go func() {
		ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(angelaDNSAnswer))
		close(recreated)
	}()
	angelaDNSWait(t, recreated, "replacement must not wait for old Listen")
	angelaDNSQuery(t, addr, "udp")
	release()
	angelaDNSStop(t)
	angelaDNSRebind(t, addr)
}
func TestAngelaNexusDNSServerHandlerCancellationAndJoin(t *testing.T) {
	for _, network := range []string{"tcp", "udp"} {
		t.Run(network, func(t *testing.T) {
			entered, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var enteredOnce, canceledOnce, releaseOnce sync.Once
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }); angelaDNSStop(t) })
			addr := angelaDNSFreeAddress(t)
			ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(angelaDNSAnswer))
			angelaDNSQuery(t, addr, network)
			ReCreateServer(addr, &angelaDNSListenConfig{}, angelaDNSServiceFunc(func(ctx context.Context, msg *D.Msg) (*D.Msg, error) {
				enteredOnce.Do(func() { close(entered) })
				<-ctx.Done()
				canceledOnce.Do(func() { close(canceled) })
				<-release // Ignore cancellation after observing it: stop must join, not only signal.
				return nil, ctx.Err()
			}))
			queryDone := make(chan struct{})
			go func() {
				defer close(queryDone)
				q := new(D.Msg)
				q.SetQuestion("blocked.angelanexus.test.", D.TypeA)
				_, _, _ = (&D.Client{Net: network, Timeout: 3 * time.Second}).Exchange(q, addr)
			}()
			angelaDNSWait(t, entered, "actual DNS handler entry")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
			err := StopServer(ctx)
			cancel()
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("stop did not retain active handler: %v", err)
			}
			angelaDNSWait(t, canceled, "handler generation context cancellation")
			releaseOnce.Do(func() { close(release) })
			angelaDNSStop(t)
			angelaDNSWait(t, queryDone, "query goroutine exit")
			angelaDNSRebind(t, addr)
		})
	}
}
