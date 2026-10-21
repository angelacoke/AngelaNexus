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
