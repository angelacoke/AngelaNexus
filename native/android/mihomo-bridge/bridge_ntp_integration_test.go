package main

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/ntp/ntp"
	"io"
	"os"
	"syscall"
)

type bridgeNTPProxy struct {
	C.Proxy
	entered, canceled, release chan struct{}
}

func (p *bridgeNTPProxy) ListenPacketContext(ctx context.Context, _ *C.Metadata) (C.PacketConn, error) {
	close(p.entered)
	<-ctx.Done()
	close(p.canceled)
	<-p.release // Deliberately ignore cancellation until the dependency exits.
	return nil, ctx.Err()
}

type bridgeNTPTunnel struct {
	C.Tunnel
	proxy *bridgeNTPProxy
}

func (t bridgeNTPTunnel) Proxies() map[string]C.Proxy { return map[string]C.Proxy{"ntp-test": t.proxy} }
func awaitBridgeNTP(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("NTP worker signal timed out")
	}
}
func bridgeNTPWorker(t *testing.T) (*bridgeNTPProxy, func()) {
	t.Helper()
	p := &bridgeNTPProxy{entered: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{})}
	var once sync.Once
	release := func() { once.Do(func() { close(p.release) }) }
	ntp.ReCreateNTPService("127.0.0.1:123", 60, "ntp-test", bridgeNTPTunnel{proxy: p}, false)
	t.Cleanup(func() {
		release()
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	})
	awaitBridgeNTP(t, p.entered)
	return p, release
}
func TestAndroidBridgeNTPExplicitStopCancelsAllGenerationsAndJoins(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	first, releaseFirst := bridgeNTPWorker(t)
	second, releaseSecond := bridgeNTPWorker(t)
	awaitBridgeNTP(t, first.canceled) // Reload canceled but retained the first owner.
	listener := &bridgeTestListener{}
	androidRuntime.listener = listener
	stopped := make(chan error, 1)
	go func() { stopped <- stopTunError() }()
	awaitBridgeNTP(t, second.canceled)
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); !errors.Is(err, errAndroidConfigurationStopped) {
		t.Fatalf("configuration crossed an in-progress NTP stop: %v", err)
	}
	select {
	case err := <-stopped:
		t.Fatalf("stop returned before NTP workers exited: %v", err)
	default:
	}
	releaseFirst()
	select {
	case err := <-stopped:
		t.Fatalf("stop lost current NTP owner: %v", err)
	default:
	}
	releaseSecond()
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
	if listener.closes != 1 || androidRuntime.ntpCleanupPending {
		t.Fatal("NTP stop skipped attachment cleanup or kept false debt")
	}
}
func TestAndroidBridgeNTPTimeoutBlocksReplacementUntilExplicitRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	p, release := bridgeNTPWorker(t)
	if err := stopAndroidNTP(20 * time.Millisecond); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("NTP timeout = %v", err)
	}
	awaitBridgeNTP(t, p.canceled)
	if !androidRuntime.ntpCleanupPending {
		t.Fatal("NTP timeout lost retry debt")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); !errors.Is(err, errAndroidNTPCleanupPending) {
		t.Fatalf("configuration bypassed NTP debt: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidNTPCleanupPending) {
		t.Fatalf("DNS reparse bypassed NTP debt: %v", err)
	}
	caller, peer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer caller.Close()
	defer peer.Close()
	constructed := false
	if startAndroidTUNWithConstructor(int(caller.Fd()), "system", "10.0.0.1/30", "", androidRuntime.stopGeneration.Load(), func(options LC.Tun) (io.Closer, error) {
		constructed = true
		_ = syscall.Close(options.FileDescriptor)
		return nil, errors.New("must not construct while NTP cleanup is pending")
	}) || constructed {
		t.Fatal("attachment bypassed NTP debt")
	}
	release()
	// Completion alone does not clear debt; explicit stop owns the retry.
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); !errors.Is(err, errAndroidNTPCleanupPending) {
		t.Fatalf("worker completion bypassed explicit stop retry: %v", err)
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if androidRuntime.ntpCleanupPending {
		t.Fatal("successful retry kept NTP debt")
	}
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	fresh, releaseFresh := bridgeNTPWorker(t)
	select {
	case <-fresh.canceled:
		t.Fatal("new NTP generation inherited cancellation")
	default:
	}
	releaseFresh()
}
func TestAndroidBridgeNTPAttachmentCleanupDoesNotCancelConfiguredService(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	p, release := bridgeNTPWorker(t)
	if err := closeAndroidResources(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-p.canceled:
		t.Fatal("attachment cleanup canceled freshly configured NTP")
	default:
	}
	stopped := make(chan error, 1)
	go func() { stopped <- stopTunError() }()
	awaitBridgeNTP(t, p.canceled)
	release()
	if err := <-stopped; err != nil {
		t.Fatal(err)
	}
}
