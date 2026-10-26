package main

import (
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/metacubex/mihomo/adapter"
	"github.com/metacubex/mihomo/adapter/outbound"
	providerpkg "github.com/metacubex/mihomo/adapter/provider"
	"github.com/metacubex/mihomo/common/utils"
	"github.com/metacubex/mihomo/component/resource"
	"github.com/metacubex/mihomo/constant"
)

// These are concrete upstream providers, not a fake WaitClosed implementation.
// The proxy observes cancellation before allowing URLTest to exit.
type bridgeHealthProxy struct {
	constant.Proxy
	entered, canceled, release chan struct{}
}

func (p *bridgeHealthProxy) URLTest(ctx context.Context, _ string, _ utils.IntRanges[uint16]) (uint16, error) {
	close(p.entered)
	<-ctx.Done()
	close(p.canceled)
	<-p.release
	return 0, ctx.Err()
}
func awaitBridgeHealth(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("concrete provider health-check signal timed out")
	}
}
func TestAndroidBridgeProviderActualHealthChecksDrainBeforeStopReturns(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	var checks []*bridgeHealthProxy
	var finished []chan struct{}
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer func() {
		releaseOnce.Do(func() { close(release) })
		_ = stopTunError()
		for _, done := range finished {
			awaitBridgeHealth(t, done)
		}
	}()
	for _, kind := range []string{"compatible", "inline", "proxy-set"} {
		proxy := &bridgeHealthProxy{Proxy: adapter.NewProxy(outbound.NewDirect()), entered: make(chan struct{}), canceled: make(chan struct{}), release: release}
		proxies := []constant.Proxy{proxy}
		hc := providerpkg.NewHealthCheck(proxies, "http://health.invalid", 60000, 0, false, nil)
		parser := func([]byte) ([]constant.Proxy, error) { return proxies, nil }
		type checkProvider interface {
			io.Closer
			HealthCheck()
		}
		var p checkProvider
		var err error
		switch kind {
		case "compatible":
			p, err = providerpkg.NewCompatibleProvider(kind, proxies, hc)
		case "inline":
			p, err = providerpkg.NewInlineProvider(kind, nil, parser, hc)
		case "proxy-set":
			p, err = providerpkg.NewProxySetProvider(kind, time.Hour, nil, parser, resource.NewFileVehicle(t.TempDir()+"/provider.yaml"), hc)
		}
		if err != nil {
			t.Fatal(err)
		}
		androidRuntime.ownProvider(kind, p)
		checks = append(checks, proxy)
		done := make(chan struct{})
		finished = append(finished, done)
		go func() { p.HealthCheck(); close(done) }()
		awaitBridgeHealth(t, proxy.entered)
	}
	stopped := make(chan error, 1)
	go func() { stopped <- stopTunError() }()
	// Every generation/type receives cancellation before any join blocks.
	for _, check := range checks {
		awaitBridgeHealth(t, check.canceled)
	}
	select {
	case err := <-stopped:
		t.Fatalf("stop reported success before health-check exit: %v", err)
	default:
	}
	releaseOnce.Do(func() { close(release) })
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	for _, done := range finished {
		awaitBridgeHealth(t, done)
	}
	if len(androidRuntime.providers) != 0 || !androidRuntime.providersStopped {
		t.Fatal("successful health-check drain did not release ownership")
	}
}

func TestAndroidBridgeProviderActualHealthCheckTimeoutRetainsOwnership(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	release := make(chan struct{})
	var once sync.Once
	proxy := &bridgeHealthProxy{Proxy: adapter.NewProxy(outbound.NewDirect()), entered: make(chan struct{}), canceled: make(chan struct{}), release: release}
	hc := providerpkg.NewHealthCheck([]constant.Proxy{proxy}, "http://health.invalid", 60000, 0, false, nil)
	p, err := providerpkg.NewCompatibleProvider("health-timeout", []constant.Proxy{proxy}, hc)
	if err != nil {
		t.Fatal(err)
	}
	androidRuntime.ownProvider("health-timeout", p)
	listener := &bridgeTestListener{}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	done := make(chan struct{})
	go func() { p.HealthCheck(); close(done) }()
	defer func() { once.Do(func() { close(release) }); _ = stopTunError(); awaitBridgeHealth(t, done) }()
	awaitBridgeHealth(t, proxy.entered)
	if err := stopTunError(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("health-check stop timeout=%v", err)
	}
	awaitBridgeHealth(t, proxy.canceled)
	if len(androidRuntime.providers) != 1 || listener.closes != 1 || androidRuntime.ready() {
		t.Fatal("timed-out health-check lost ownership or skipped attachment cleanup")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); !errors.Is(err, errAndroidProviderCleanupPending) {
		t.Fatalf("configuration bypassed health-check cleanup debt: %v", err)
	}
	once.Do(func() { close(release) })
	awaitBridgeHealth(t, done)
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.providers) != 0 {
		t.Fatal("retry did not release completed health-check provider")
	}
}

// Independently hold a real Fetcher parser and a real health-check URLTest.
// Omitting either embedded waiter must lose one owner on the first timeout.
func TestAndroidBridgeProviderActualProxySetJoinsBothComponents(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	healthRelease, parserRelease := make(chan struct{}), make(chan struct{})
	var healthOnce, parserOnce sync.Once
	proxy := &bridgeHealthProxy{Proxy: adapter.NewProxy(outbound.NewDirect()), entered: make(chan struct{}), canceled: make(chan struct{}), release: healthRelease}
	proxies := []constant.Proxy{proxy}
	health := providerpkg.NewHealthCheck(proxies, "http://health.invalid", 60000, 0, false, nil)
	healthProvider, err := providerpkg.NewProxySetProvider("held-health", time.Hour, nil,
		func([]byte) ([]constant.Proxy, error) { return proxies, nil },
		resource.NewFileVehicle(t.TempDir()+"/health.yaml"), health)
	if err != nil {
		t.Fatal(err)
	}
	parserEntered := make(chan struct{})
	fetchProvider, err := providerpkg.NewProxySetProvider("held-fetcher", time.Hour, nil,
		func([]byte) ([]constant.Proxy, error) {
			close(parserEntered)
			<-parserRelease
			return nil, nil
		}, resource.NewFileVehicle(t.TempDir()+"/fetcher.yaml"),
		providerpkg.NewHealthCheck(nil, "", 5000, 0, false, nil))
	if err != nil {
		_ = healthProvider.Close()
		t.Fatal(err)
	}
	androidRuntime.ownProvider("held-health", healthProvider)
	androidRuntime.ownProvider("held-fetcher", fetchProvider)
	healthDone := make(chan struct{})
	fetchDone := make(chan error, 1)
	go func() { healthProvider.HealthCheck(); close(healthDone) }()
	go func() { _, _, err := fetchProvider.SideUpdate([]byte("payload")); fetchDone <- err }()
	defer func() {
		healthOnce.Do(func() { close(healthRelease) })
		parserOnce.Do(func() { close(parserRelease) })
		_ = stopTunError()
		awaitBridgeHealth(t, healthDone)
	}()
	awaitBridgeHealth(t, proxy.entered)
	awaitBridgeHealth(t, parserEntered)
	if err := stopTunError(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("independent component debt did not time out: %v", err)
	}
	if len(androidRuntime.providers) != 2 {
		t.Fatalf("one embedded waiter was skipped; retained %d providers, want 2", len(androidRuntime.providers))
	}
	awaitBridgeHealth(t, proxy.canceled)
	healthOnce.Do(func() { close(healthRelease) })
	awaitBridgeHealth(t, healthDone)
	if err := stopTunError(); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("remaining Fetcher debt did not time out: %v", err)
	}
	if len(androidRuntime.providers) != 1 || androidRuntime.providers[fetchProvider] != "held-fetcher" {
		t.Fatal("retry did not retain exactly the blocked Fetcher component")
	}
	parserOnce.Do(func() { close(parserRelease) })
	select {
	case err := <-fetchDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled parser result = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Fetcher parser did not exit")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.providers) != 0 {
		t.Fatal("completed components remained owned after retry")
	}
}
