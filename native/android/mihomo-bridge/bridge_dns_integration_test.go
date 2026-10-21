package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/metacubex/mihomo/component/resolver"
	"github.com/metacubex/mihomo/dns"
	LC "github.com/metacubex/mihomo/listener/config"
	D "github.com/miekg/dns"
)

func bridgeDNSAddress(t *testing.T) string {
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

func bridgeDNSQuery(t *testing.T, addr, network string) {
	t.Helper()
	query := new(D.Msg)
	query.SetQuestion("bridge-dns.angelanexus.test.", D.TypeA)
	deadline := time.Now().Add(3 * time.Second)
	for {
		client := &D.Client{Net: network, Timeout: 100 * time.Millisecond}
		answer, _, err := client.Exchange(query, addr)
		if err == nil && answer != nil && answer.Rcode == D.RcodeRefused {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s DNS query never became ready: %v, %v", network, answer, err)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestAndroidBridgeDNSExplicitStopReleasesBothListeners(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	})
	addr := bridgeDNSAddress(t)
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["dns"] = map[string]any{"enable": true, "listen": addr, "nameserver": []string{"rcode://refused"}, "default-nameserver": []string{"127.0.0.1"}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for generation := 0; generation < 2; generation++ {
		if err := applyAndroidConfigJSON(data); err != nil {
			t.Fatal(err)
		}
		bridgeDNSQuery(t, addr, "tcp")
		bridgeDNSQuery(t, addr, "udp")
		// startTUN uses this attachment cleanup after applying configuration.
		// It must not stop DNS listeners from the just-applied configuration.
		if err := closeAndroidResources(); err != nil {
			t.Fatal(err)
		}
		bridgeDNSQuery(t, addr, "tcp")
		bridgeDNSQuery(t, addr, "udp")
		if err := stopTunError(); err != nil {
			t.Fatal(err)
		}
		l, err := net.Listen("tcp", addr)
		if err != nil {
			t.Fatalf("stop left TCP DNS listener open: %v", err)
		}
		p, err := net.ListenPacket("udp", addr)
		if err != nil {
			_ = l.Close()
			t.Fatalf("stop left UDP DNS listener open: %v", err)
		}
		_ = l.Close()
		_ = p.Close()
	}
}

type bridgeDNSBlockedListen struct {
	entered chan struct{}
	release chan struct{}
}

func (l *bridgeDNSBlockedListen) Listen(context.Context, string, string) (net.Listener, error) {
	l.entered <- struct{}{}
	<-l.release // Deliberately ignore cancellation: a late resource still needs an owner.
	return net.Listen("tcp", "127.0.0.1:0")
}
func (l *bridgeDNSBlockedListen) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	l.entered <- struct{}{}
	<-l.release
	return net.ListenPacket("udp", "127.0.0.1:0")
}

type bridgeDNSService struct{}

func (bridgeDNSService) ServeMsg(_ context.Context, query *D.Msg) (*D.Msg, error) {
	answer := new(D.Msg)
	answer.SetRcode(query, D.RcodeRefused)
	return answer, nil
}

func TestAndroidBridgeDNSTimeoutRetainsRetryBarrier(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	lc := &bridgeDNSBlockedListen{entered: make(chan struct{}, 2), release: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() {
		release.Do(func() { close(lc.release) })
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	})
	dns.ReCreateServer("127.0.0.1:5353", lc, bridgeDNSService{})
	for i := 0; i < 2; i++ {
		select {
		case <-lc.entered:
		case <-time.After(3 * time.Second):
			t.Fatal("DNS listen did not enter")
		}
	}
	// The short helper uses the same upstream call/debt tracking as stopTunError.
	androidTunMu.Lock()
	err := stopAndroidDNS(10 * time.Millisecond)
	androidTunMu.Unlock()
	if !errors.Is(err, context.DeadlineExceeded) || !androidRuntime.dnsCleanupPending {
		t.Fatalf("unjoined DNS startup was reported clean: %v, pending=%v", err, androidRuntime.dnsCleanupPending)
	}
	saved := append([]byte(nil), lastConfigJSON...)
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); !errors.Is(err, errAndroidDNSCleanupPending) {
		t.Fatalf("apply bypassed DNS cleanup debt: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidDNSCleanupPending) {
		t.Fatalf("DNS update bypassed cleanup debt: %v", err)
	}
	if !bytes.Equal(saved, lastConfigJSON) {
		t.Fatal("rejected DNS replacement changed saved configuration")
	}
	fd, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer fd.Close()
	called := false
	if startAndroidTUNWithConstructor(int(fd.Fd()), "system", "", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) { called = true; return nil, errors.New("unexpected constructor") }) || called {
		t.Fatal("TUN attachment bypassed pending DNS cleanup")
	}
	if _, err := fd.Stat(); err != nil {
		t.Fatalf("rejected attachment consumed caller descriptor: %v", err)
	}
	release.Do(func() { close(lc.release) })
	if err := stopTunError(); err != nil {
		t.Fatalf("DNS cleanup retry failed: %v", err)
	}
	if androidRuntime.dnsCleanupPending {
		t.Fatal("successful DNS retry retained debt")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
		t.Fatalf("fresh configuration blocked after DNS cleanup: %v", err)
	}
}

// The client gate observes the real upstream resolver path, not a fake waiter.
type bridgeDNSResolverClient struct {
	entered      chan struct{}
	canceled     chan struct{}
	release      chan struct{}
	ignoreCancel bool
	once         sync.Once
	cancelOnce   sync.Once
}

func (c *bridgeDNSResolverClient) Address() string  { return "bridge-generation.test" }
func (c *bridgeDNSResolverClient) ResetConnection() {}
func (c *bridgeDNSResolverClient) ExchangeContext(ctx context.Context, query *D.Msg) (*D.Msg, error) {
	c.once.Do(func() { close(c.entered) })
	<-ctx.Done()
	c.cancelOnce.Do(func() { close(c.canceled) })
	if c.ignoreCancel {
		<-c.release
		answer := new(D.Msg)
		answer.SetRcode(query, D.RcodeRefused)
		return answer, nil // Deliberately return a late success after cancellation.
	}
	return nil, ctx.Err()
}

func bridgeDNSWait(t *testing.T, ch <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}

func bridgeDNSResolverQuery() *D.Msg {
	query := new(D.Msg)
	query.SetQuestion("owned-generation.angelanexus.test.", D.TypeA)
	return query
}

func TestAndroidBridgeDNSResolverExplicitStopCancelsAndJoins(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	client := &bridgeDNSResolverClient{entered: make(chan struct{}), canceled: make(chan struct{})}
	generation := dns.Resolvers{Resolver: dns.NewResolverFromClient(client)}
	androidRuntime.ownResolvers(generation)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = generation.ExchangeContext(context.Background(), bridgeDNSResolverQuery())
	}()
	bridgeDNSWait(t, client.entered, "in-flight resolver client")
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	bridgeDNSWait(t, client.canceled, "resolver cancellation")
	bridgeDNSWait(t, done, "resolver caller exit")
	if len(androidRuntime.resolvers) != 0 || !androidRuntime.resolversStopped || androidRuntime.dnsCleanupPending {
		t.Fatal("explicit stop did not join resolver ownership or reopened the generation")
	}
	if answer, err := generation.ExchangeContext(context.Background(), bridgeDNSResolverQuery()); err == nil || answer != nil {
		t.Fatalf("stopped generation accepted a new request: %v, %v", answer, err)
	}
}

func TestAndroidBridgeDNSResolverTimeoutBlocksReplacementUntilRetry(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	client := &bridgeDNSResolverClient{entered: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{}), ignoreCancel: true}
	generation := dns.Resolvers{Resolver: dns.NewResolverFromClient(client)}
	androidRuntime.ownResolvers(generation)
	var release sync.Once
	done := make(chan struct{})
	t.Cleanup(func() {
		release.Do(func() { close(client.release) })
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
		bridgeDNSWait(t, done, "late resolver caller cleanup")
	})
	go func() {
		defer close(done)
		answer, err := generation.ExchangeContext(context.Background(), bridgeDNSResolverQuery())
		if err == nil || answer != nil {
			t.Errorf("stopped resolver published late success: %v, %v", answer, err)
		}
	}()
	bridgeDNSWait(t, client.entered, "ignoring resolver client")
	androidTunMu.Lock()
	err := stopAndroidDNS(10 * time.Millisecond)
	androidTunMu.Unlock()
	if !errors.Is(err, context.DeadlineExceeded) || !androidRuntime.dnsCleanupPending || len(androidRuntime.resolvers) == 0 {
		t.Fatalf("unjoined resolver reported clean: %v, pending=%v, owned=%d", err, androidRuntime.dnsCleanupPending, len(androidRuntime.resolvers))
	}
	bridgeDNSWait(t, client.canceled, "ignoring resolver cancellation")
	saved := append([]byte(nil), lastConfigJSON...)
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); !errors.Is(err, errAndroidDNSCleanupPending) {
		t.Fatalf("apply bypassed resolver debt: %v", err)
	}
	if err := updateAndroidDNS("127.0.0.1"); !errors.Is(err, errAndroidDNSCleanupPending) {
		t.Fatalf("DNS update bypassed resolver debt: %v", err)
	}
	if !bytes.Equal(saved, lastConfigJSON) {
		t.Fatal("rejected resolver replacement changed saved configuration")
	}
	fd, err := os.Open("/dev/null")
	if err != nil {
		t.Fatal(err)
	}
	defer fd.Close()
	called := false
	if startAndroidTUNWithConstructor(int(fd.Fd()), "system", "", "", androidRuntime.stopGeneration.Load(), func(LC.Tun) (io.Closer, error) { called = true; return nil, errors.New("unexpected constructor") }) || called {
		t.Fatal("TUN attachment bypassed resolver debt")
	}
	if _, err := fd.Stat(); err != nil {
		t.Fatal("rejected resolver attachment consumed caller descriptor")
	}
	release.Do(func() { close(client.release) })
	if err := stopTunError(); err != nil {
		t.Fatalf("resolver cleanup retry: %v", err)
	}
	if androidRuntime.dnsCleanupPending || len(androidRuntime.resolvers) != 0 {
		t.Fatal("resolver cleanup retry retained debt")
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("direct")); err != nil {
		t.Fatalf("fresh configuration blocked after resolver join: %v", err)
	}
}

func TestAndroidBridgeDNSResolverOwnsReloadedAndDisabledGenerations(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	})
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["dns"] = map[string]any{"enable": true, "nameserver": []string{"rcode://refused"}, "default-nameserver": []string{"127.0.0.1"}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var generations []dns.Resolvers
	for i := 0; i < 2; i++ {
		if err := applyAndroidConfigJSON(data); err != nil {
			t.Fatal(err)
		}
		generation, ok := resolver.DefaultResolver.(dns.Resolvers)
		if !ok {
			t.Fatalf("configured resolver type %T", resolver.DefaultResolver)
		}
		generations = append(generations, generation)
		if _, ok := androidRuntime.resolvers[generation]; !ok {
			t.Fatal("published resolver was not owned by Android")
		}
		if err := closeAndroidResources(); err != nil {
			t.Fatal(err)
		}
		if answer, err := generation.ExchangeContext(context.Background(), bridgeDNSResolverQuery()); err != nil || answer.Rcode != D.RcodeRefused {
			t.Fatalf("attachment cleanup stopped configured resolver: %v, %v", answer, err)
		}
	}
	if err := applyAndroidConfigJSON(bridgeConfigJSON("rule")); err != nil {
		t.Fatal(err)
	}
	if len(androidRuntime.resolvers) != 2 {
		t.Fatalf("DNS disable/reload lost old generation ownership: %d", len(androidRuntime.resolvers))
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	for _, generation := range generations {
		if answer, err := generation.ExchangeContext(context.Background(), bridgeDNSResolverQuery()); err == nil || answer != nil {
			t.Fatalf("retired generation survived explicit stop: %v, %v", answer, err)
		}
	}
	if err := applyAndroidConfigJSON(data); err != nil {
		t.Fatal(err)
	}
	fresh := resolver.DefaultResolver.(dns.Resolvers)
	if fresh.Resolver == generations[0].Resolver || fresh.Resolver == generations[1].Resolver || androidRuntime.resolversStopped {
		t.Fatal("fresh apply reused or remained in a stopped generation")
	}
	if answer, err := fresh.ExchangeContext(context.Background(), bridgeDNSResolverQuery()); err != nil || answer.Rcode != D.RcodeRefused {
		t.Fatalf("fresh generation received old cancellation: %v, %v", answer, err)
	}
}
