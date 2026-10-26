package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter"
	"github.com/metacubex/mihomo/adapter/outbound"
	"github.com/metacubex/mihomo/common/utils"
	"github.com/metacubex/mihomo/component/resource"
	C "github.com/metacubex/mihomo/constant"
)

type healthLifecycleProxy struct {
	C.Proxy
	test func(context.Context) (uint16, error)
}

func (p *healthLifecycleProxy) URLTest(ctx context.Context, _ string, _ utils.IntRanges[uint16]) (uint16, error) {
	return p.test(ctx)
}
func healthProxy(fn func(context.Context) (uint16, error)) C.Proxy {
	return &healthLifecycleProxy{Proxy: adapter.NewProxy(outbound.NewDirect()), test: fn}
}
func awaitHealthSignal(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("health-check signal timed out")
	}
}
func waitHealth(t *testing.T, hc *HealthCheck) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := hc.waitClosed(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusHealthCheckActualHTTPCancelAndJoin(t *testing.T) {
	entered, canceled := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
		close(canceled)
	}))
	hc := NewHealthCheck([]C.Proxy{adapter.NewProxy(outbound.NewDirect())}, server.URL, 60000, 3600, false, nil)
	defer server.Close()
	defer func() { hc.close(); waitHealth(t, hc) }()
	if err := hc.start(); err != nil {
		t.Fatal(err)
	}
	awaitHealthSignal(t, entered)
	hc.close()
	waitHealth(t, hc)
	awaitHealthSignal(t, canceled)
	hc.mu.Lock()
	active := hc.active
	hc.mu.Unlock()
	if active != 0 {
		t.Fatalf("successful drain left %d owners", active)
	}
	if err := hc.start(); !errors.Is(err, context.Canceled) {
		t.Fatalf("restart after close = %v", err)
	}
}

func TestAngelaNexusHealthCheckConcreteProviderTimeoutAndRetry(t *testing.T) {
	for _, kind := range []string{"compatible", "inline", "proxy-set"} {
		t.Run(kind, func(t *testing.T) {
			entered, canceled, release, returned := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
			var once sync.Once
			var calls atomic.Int32
			proxy := healthProxy(func(ctx context.Context) (uint16, error) {
				calls.Add(1)
				close(entered)
				<-ctx.Done()
				close(canceled)
				<-release
				close(returned)
				return 0, ctx.Err()
			})
			proxies := []C.Proxy{proxy}
			hc := NewHealthCheck(proxies, "http://health.invalid", 60000, 0, false, nil)
			type providerResource interface {
				Close() error
				WaitClosed(context.Context) error
				HealthCheck()
				Initial() error
			}
			var p providerResource
			var err error
			parser := func([]byte) ([]C.Proxy, error) { return proxies, nil }
			switch kind {
			case "compatible":
				p, err = NewCompatibleProvider(kind, proxies, hc)
			case "inline":
				p, err = NewInlineProvider(kind, nil, parser, hc)
			case "proxy-set":
				p, err = NewProxySetProvider(kind, time.Hour, nil, parser, resource.NewFileVehicle(filepath.Join(t.TempDir(), "provider.yaml")), hc)
			}
			if err != nil {
				t.Fatal(err)
			}
			defer func() { once.Do(func() { close(release) }); _ = p.Close(); waitHealth(t, hc) }()
			if err := p.WaitClosed(context.Background()); err == nil {
				t.Fatal("wait before Close succeeded")
			}
			done := make(chan struct{})
			go func() { p.HealthCheck(); close(done) }()
			awaitHealthSignal(t, entered)
			if err := p.Close(); err != nil {
				t.Fatal(err)
			}
			awaitHealthSignal(t, canceled)
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if err := p.WaitClosed(ctx); !errors.Is(err, context.Canceled) {
				t.Fatalf("uncooperative health worker was not retained: %v", err)
			}
			// Closed manual/async/start entry points cannot restart a worker.
			p.HealthCheck()
			hc.startCheck()
			hc.setProxies(proxies)
			hc.registerHealthCheckTask("http://extra.invalid", nil, "DIRECT", 1)
			if err := p.Initial(); !errors.Is(err, context.Canceled) {
				t.Fatalf("Initial after close = %v", err)
			}
			once.Do(func() { close(release) })
			waitCtx, waitCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer waitCancel()
			if err := p.WaitClosed(waitCtx); err != nil {
				t.Fatal(err)
			}
			awaitHealthSignal(t, returned)
			awaitHealthSignal(t, done)
			if calls.Load() != 1 {
				t.Fatalf("closed provider started %d checks", calls.Load())
			}
			if err := p.Close(); err != nil {
				t.Fatal(err)
			}
			if err := p.WaitClosed(ctx); err != nil {
				t.Fatalf("completed drain with expired context = %v", err)
			}
		})
	}
}

func TestAngelaNexusHealthCheckDuplicateLoopStartAndConcurrentClose(t *testing.T) {
	entered := make(chan struct{})
	var once sync.Once
	hc := NewHealthCheck([]C.Proxy{healthProxy(func(ctx context.Context) (uint16, error) {
		once.Do(func() { close(entered) })
		<-ctx.Done()
		return 0, ctx.Err()
	})}, "http://health.invalid", 60000, 3600, false, nil)
	defer func() { hc.close(); waitHealth(t, hc) }()
	if err := hc.start(); err != nil {
		t.Fatal(err)
	}
	awaitHealthSignal(t, entered)
	for i := 0; i < 50; i++ {
		if err := hc.start(); err != nil {
			t.Fatal(err)
		}
	}
	hc.mu.Lock()
	active := hc.active
	hc.mu.Unlock()
	if active != 2 {
		t.Fatalf("duplicate start created extra loop owners: %d", active)
	}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			hc.close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := hc.waitClosed(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
}

func TestAngelaNexusHealthCheckQueuedWorkersDoNotStartAfterCancel(t *testing.T) {
	const limit = 10
	entered, release := make(chan struct{}, limit), make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	proxy := healthProxy(func(ctx context.Context) (uint16, error) {
		calls.Add(1)
		entered <- struct{}{}
		<-ctx.Done()
		<-release
		return 0, ctx.Err()
	})
	proxies := make([]C.Proxy, 30)
	for i := range proxies {
		proxies[i] = proxy
	}
	hc := NewHealthCheck(proxies, "http://health.invalid", 60000, 0, false, nil)
	defer func() { once.Do(func() { close(release) }); hc.close(); waitHealth(t, hc) }()
	hc.startCheck()
	for i := 0; i < limit; i++ {
		awaitHealthSignal(t, entered)
	}
	hc.close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := hc.waitClosed(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("saturated check drain = %v", err)
	}
	once.Do(func() { close(release) })
	waitHealth(t, hc)
	if calls.Load() != limit {
		t.Fatalf("queued URLTest ran after cancellation: calls=%d", calls.Load())
	}
}

func TestAngelaNexusHealthCheckCloseReentrantFromURLTest(t *testing.T) {
	var hc *HealthCheck
	returned := make(chan struct{})
	hc = NewHealthCheck([]C.Proxy{healthProxy(func(context.Context) (uint16, error) { hc.close(); close(returned); return 0, nil })}, "http://health.invalid", 5000, 0, false, nil)
	defer func() { hc.close(); waitHealth(t, hc) }()
	hc.startCheck()
	awaitHealthSignal(t, returned)
	waitHealth(t, hc)
}

// Reset deliberately bypasses the production single-flight cache to stress
// snapshot locking; this test makes no single-flight/deduplication claim.
func TestAngelaNexusHealthCheckConcurrentSnapshotsAndUpdates(t *testing.T) {
	proxies := []C.Proxy{healthProxy(func(context.Context) (uint16, error) { return 1, nil })}
	hc := NewHealthCheck(proxies, "http://health.invalid", 5000, 1, false, nil)
	defer func() { hc.close(); waitHealth(t, hc) }()
	hc.registerHealthCheckTask("http://extra.invalid", nil, "DIRECT", 1)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			<-start
			for i := 0; i < 128; i++ {
				switch worker {
				case 0:
					hc.singleDo.Reset()
					hc.check()
				case 1:
					hc.setProxies(proxies)
				case 2:
					hc.registerHealthCheckTask("http://extra.invalid", nil, "DIRECT`REJECT", 1)
				case 3:
					_ = hc.start()
					hc.startCheck()
					_ = hc.auto()
				}
			}
		}(worker)
	}
	close(start)
	wg.Wait()
	// Do not let an early Close hide races by rejecting all mutations/checks.
	hc.close()
	waitHealth(t, hc)
}

func TestAngelaNexusHealthCheckSnapshotsAndStartupCloseRace(t *testing.T) {
	for iteration := 0; iteration < 32; iteration++ {
		proxies := []C.Proxy{healthProxy(func(context.Context) (uint16, error) { return 1, nil })}
		hc := NewHealthCheck(proxies, "http://health.invalid", 5000, 1, false, nil)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for worker := 0; worker < 5; worker++ {
			wg.Add(1)
			go func(worker int) {
				defer wg.Done()
				<-start
				for i := 0; i < 32; i++ {
					switch worker {
					case 0:
						_ = hc.start()
						hc.startCheck()
						hc.check()
					case 1:
						hc.setProxies(proxies)
					case 2:
						hc.registerHealthCheckTask("http://extra.invalid", nil, "DIRECT", 1)
					case 3:
						_ = hc.auto()
						hc.touch()
						hc.singleDo.Reset()
					case 4:
						hc.close()
					}
				}
			}(worker)
		}
		close(start)
		wg.Wait()
		hc.close()
		waitHealth(t, hc)
		if err := hc.start(); !errors.Is(err, context.Canceled) {
			t.Fatalf("late start=%v", err)
		}
	}
}
