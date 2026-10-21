package outbound

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/tunnel/statistic"
)

func dnsLifecycleConn(relay func(context.Context, []byte, []byte) ([]byte, error), puts *atomic.Int32) *dnsPacketConn {
	d := newDNSPacketConn(relay)
	d.get = func(n int) []byte { return make([]byte, n) }
	d.put = func([]byte) error { puts.Add(1); return nil }
	return d
}

func dnsLifecycleWait(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("lifecycle barrier timed out")
	}
}

func TestAngelaNexusDNSOutboundReadCopiesBeforePut(t *testing.T) {
	var puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { copy(p, []byte("answer")); return p[:6], nil }, &puts)
	d.put = func(p []byte) error { copy(p, []byte("poison")); puts.Add(1); return nil }
	if _, err := d.WriteTo([]byte("query!"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 16)
	n, _, err := d.ReadFrom(got)
	if err != nil || string(got[:n]) != "answer" {
		t.Fatalf("ReadFrom=%q,%v", got[:n], err)
	}
	if puts.Load() != 1 {
		t.Fatalf("put count=%d", puts.Load())
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusDNSOutboundQueuedBeforeCloseIsReclaimed(t *testing.T) {
	var puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &puts)
	if _, err := d.WriteTo([]byte("queued"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(d.response) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(d.response) != 1 {
		t.Fatal("worker did not finish with one queued response")
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if puts.Load() != 1 {
		t.Fatalf("queued buffer releases=%d", puts.Load())
	}
	if len(d.response) != 0 {
		t.Fatal("stale response remained after close")
	}
}

func TestAngelaNexusDNSOutboundLegacyQueuedClose(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var puts atomic.Int32
	d := &dnsPacketConn{ctx: ctx, cancel: cancel, response: make(chan dnsPacket, 1)}
	d.response <- dnsPacket{data: []byte("legacy"), put: func() { puts.Add(1) }, addr: &net.UDPAddr{}}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if puts.Load() != 1 || len(d.response) != 0 {
		t.Fatalf("put=%d queue=%d", puts.Load(), len(d.response))
	}
	if _, _, err := d.ReadFrom(make([]byte, 16)); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("ReadFrom=%v", err)
	}
	if _, _, _, err := d.WaitReadFrom(); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("WaitReadFrom=%v", err)
	}
}

func TestAngelaNexusDNSOutboundLateSuccessAfterCancelIsReclaimed(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var puts atomic.Int32
	d := dnsLifecycleConn(func(ctx context.Context, p, _ []byte) ([]byte, error) {
		close(entered)
		<-release
		return p, nil // deliberate success after cancellation
	}, &puts)
	if _, err := d.WriteTo([]byte("late"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	dnsLifecycleWait(t, entered)
	closeDone := make(chan error, 1)
	go func() { closeDone <- d.Close() }()
	dnsLifecycleWait(t, d.ctx.Done())
	close(release)
	if err := <-closeDone; err != nil {
		t.Fatal(err)
	}
	if puts.Load() != 1 || len(d.response) != 0 {
		t.Fatalf("late cleanup puts=%d queue=%d", puts.Load(), len(d.response))
	}
}

func TestAngelaNexusDNSOutboundFinalPutBlocksCloseAndReusesWaiter(t *testing.T) {
	putEntered, putRelease := make(chan struct{}), make(chan struct{})
	var puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &puts)
	d.put = func([]byte) error { puts.Add(1); close(putEntered); <-putRelease; return nil }
	if _, err := d.WriteTo([]byte("x"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(d.response) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(d.response) != 1 {
		t.Fatal("response was not queued")
	}
	first := make(chan error, 1)
	go func() { first <- d.closeWithContext(context.Background()) }()
	dnsLifecycleWait(t, putEntered)
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	waiter := d.closeWaiter
	if err := d.closeWithContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked close=%v", err)
	}
	if d.closeWaiter != waiter {
		t.Fatal("timeout replaced close waiter")
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := d.Close(); err != nil {
				t.Error(err)
			}
		}()
	}
	close(putRelease)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if puts.Load() != 1 {
		t.Fatalf("put count=%d", puts.Load())
	}
}

func TestAngelaNexusDNSOutboundConcurrentPreAdmitCloseAndInstanceIsolation(t *testing.T) {
	var p1, p2 atomic.Int32
	d1 := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &p1)
	d2 := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &p2)
	var admitted sync.WaitGroup
	for i := 0; i < 32; i++ {
		admitted.Add(2)
		go func() { defer admitted.Done(); _, _ = d1.WriteTo([]byte("a"), &net.UDPAddr{}) }()
		go func() { defer admitted.Done(); _, _ = d2.WriteTo([]byte("b"), &net.UDPAddr{}) }()
	}
	admitted.Wait() // every write has passed admission before close begins
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(4)
		go func() { defer wg.Done(); _, _, _ = d1.ReadFrom(make([]byte, 8)) }()
		go func() { defer wg.Done(); _, _, _ = d2.ReadFrom(make([]byte, 8)) }()
		go func() { defer wg.Done(); _ = d1.Close() }()
		go func() { defer wg.Done(); _ = d2.Close() }()
	}
	wg.Wait()
	if err := d1.Close(); err != nil {
		t.Fatal(err)
	}
	if err := d2.Close(); err != nil {
		t.Fatal(err)
	}
	if p1.Load() == 0 || p2.Load() == 0 {
		t.Fatalf("isolated instance cleanup p1=%d p2=%d", p1.Load(), p2.Load())
	}
}

type dnsLifecycleShortClose struct {
	C.PacketConn
	raw *dnsPacketConn
}

func (d dnsLifecycleShortClose) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	return d.raw.closeWithContext(ctx)
}
func unwrapDNSPacketConn(t *testing.T, pc C.PacketConn) *dnsPacketConn {
	t.Helper()
	var current any = pc
	for i := 0; i < 16; i++ {
		if d, ok := current.(*dnsPacketConn); ok {
			return d
		}
		u, ok := current.(interface{ Upstream() any })
		if !ok {
			break
		}
		current = u.Upstream()
	}
	t.Fatal("production packet connection did not unwrap to dnsPacketConn")
	return nil
}

func TestAngelaNexusDNSOutboundProductionTrackerTimeoutRetainsAndRetries(t *testing.T) {
	manager := statistic.DefaultManager
	manager.StartStatistics()
	manager.StartRegistrations()
	var puts atomic.Int32
	d1 := NewDnsWithOption(DnsOption{Name: "dns-lifecycle-1"})
	d2 := NewDnsWithOption(DnsOption{Name: "dns-lifecycle-2"})
	meta1 := &C.Metadata{NetWork: C.UDP}
	meta2 := &C.Metadata{NetWork: C.UDP}
	pc1, err := d1.ListenPacketContext(context.Background(), meta1)
	if err != nil {
		t.Fatal(err)
	}
	pc2, err := d2.ListenPacketContext(context.Background(), meta2)
	if err != nil {
		t.Fatal(err)
	}
	raw1, raw2 := unwrapDNSPacketConn(t, pc1), unwrapDNSPacketConn(t, pc2)
	raw1.relay = func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }
	raw2.relay = func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }
	blocked := make(chan struct{})
	raw1.put = func([]byte) error { puts.Add(1); <-blocked; return nil }
	tracked := statistic.NewUDPTracker(dnsLifecycleShortClose{PacketConn: pc1, raw: raw1}, manager, meta1, nil, 0, 0, false)
	if manager.Get(tracked.ID()) == nil {
		t.Fatal("production tracker was not registered")
	}
	if _, err := tracked.WriteTo([]byte("one"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(raw1.response) != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if err := tracked.Close(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("tracker hid timeout: %v", err)
	}
	if manager.Get(tracked.ID()) == nil {
		t.Fatal("timed-out tracker was removed")
	}
	close(blocked)
	dnsLifecycleWait(t, raw1.closeWaiter.done)
	if err := tracked.Close(); err != nil {
		t.Fatal(err)
	}
	if manager.Get(tracked.ID()) != nil {
		t.Fatal("successful retry retained tracker")
	}
	if _, err := pc2.WriteTo([]byte("two"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 16)
	n, _, err := pc2.ReadFrom(buf)
	if err != nil || string(buf[:n]) != "two" {
		t.Fatalf("second instance relay=%q,%v", buf[:n], err)
	}
	_ = pc2.Close()
}

func TestAngelaNexusDNSOutboundActiveWorkerCancellationJoinAndRetry(t *testing.T) {
	entered, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var puts atomic.Int32
	d := dnsLifecycleConn(func(ctx context.Context, p, _ []byte) ([]byte, error) {
		close(entered)
		<-ctx.Done()
		close(canceled)
		<-release // cleanup can outlive cancellation; it must still be owned
		return p, nil
	}, &puts)
	if _, err := d.WriteTo([]byte("active"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	dnsLifecycleWait(t, entered)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if err := d.closeWithContext(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("active worker was not joined: %v", err)
	}
	dnsLifecycleWait(t, canceled)
	waiter := d.closeWaiter
	select {
	case <-waiter.done:
		t.Fatal("close completed before relay exit and buffer cleanup")
	default:
	}
	if _, err := d.WriteTo([]byte("rejected"), &net.UDPAddr{}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("post-stop admission: %v", err)
	}
	close(release)
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if d.closeWaiter != waiter || puts.Load() != 1 || len(d.response) != 0 {
		t.Fatalf("lost close ownership, puts=%d queue=%d", puts.Load(), len(d.response))
	}
	canceledCtx, cancelAgain := context.WithCancel(context.Background())
	cancelAgain()
	if err := d.closeWithContext(canceledCtx); err != nil {
		t.Fatalf("completed close lost to canceled caller: %v", err)
	}
}

func TestAngelaNexusDNSOutboundUncooperativeWorkerRetained(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) {
		close(entered)
		<-release // ignores cancellation completely
		return p, nil
	}, &puts)
	if _, err := d.WriteTo([]byte("stuck"), &net.UDPAddr{}); err != nil {
		t.Fatal(err)
	}
	dnsLifecycleWait(t, entered)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := d.closeWithContext(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("uncooperative worker incorrectly retired: %v", err)
	}
	waiter := d.closeWaiter
	for i := 0; i < 8; i++ {
		if err := d.closeWithContext(ctx); !errors.Is(err, context.Canceled) || d.closeWaiter != waiter {
			t.Fatalf("retry abandoned or replaced worker owner: %v", err)
		}
	}
	close(release)
	if err := d.Close(); err != nil || puts.Load() != 1 {
		t.Fatalf("retry cleanup err=%v puts=%d", err, puts.Load())
	}
}

func TestAngelaNexusDNSOutboundConcurrentAdmissionClose(t *testing.T) {
	var gets, puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &puts)
	d.get = func(n int) []byte { gets.Add(1); return make([]byte, n) }
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := d.WriteTo([]byte("concurrent"), &net.UDPAddr{})
			if err != nil && !errors.Is(err, net.ErrClosed) {
				t.Error(err)
			}
		}()
	}
	wg.Add(1)
	go func() { defer wg.Done(); <-start; _ = d.Close() }()
	close(start)
	wg.Wait()
	if err := d.Close(); err != nil || gets.Load() != puts.Load() || len(d.response) != 0 {
		t.Fatalf("admission/close ownership: err=%v gets=%d puts=%d queue=%d", err, gets.Load(), puts.Load(), len(d.response))
	}
}

func TestAngelaNexusDNSOutboundReturnsOriginalAllocation(t *testing.T) {
	for _, mode := range []string{"read", "queued", "error"} {
		t.Run(mode, func(t *testing.T) {
			allocated := make([]byte, 2048)
			var puts atomic.Int32
			d := dnsLifecycleConn(func(_ context.Context, _, _ []byte) ([]byte, error) {
				if mode == "error" {
					return nil, errors.New("relay failed")
				}
				return []byte("independent-result"), nil
			}, &puts)
			d.get = func(int) []byte { return allocated }
			d.put = func(p []byte) error {
				if len(p) == 0 || &p[0] != &allocated[0] {
					t.Error("released relay output instead of original allocator buffer")
				}
				puts.Add(1)
				return nil
			}
			if _, err := d.WriteTo([]byte("query"), &net.UDPAddr{}); err != nil {
				t.Fatal(err)
			}
			if mode == "read" {
				b := make([]byte, 32)
				n, _, err := d.ReadFrom(b)
				if err != nil || string(b[:n]) != "independent-result" {
					t.Fatalf("independent result: %q %v", b[:n], err)
				}
			}
			if err := d.Close(); err != nil || puts.Load() != 1 {
				t.Fatalf("allocation release err=%v count=%d", err, puts.Load())
			}
		})
	}
}

func TestAngelaNexusDNSOutboundRejectsPostCloseAdmission(t *testing.T) {
	var puts atomic.Int32
	d := dnsLifecycleConn(func(_ context.Context, p, _ []byte) ([]byte, error) { return p, nil }, &puts)
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.WriteTo([]byte("after-close"), &net.UDPAddr{}); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("accepted worker after completed close: %v", err)
	}
}
