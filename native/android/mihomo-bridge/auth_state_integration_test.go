package inbound_test

import (
	"encoding/json"
	"fmt"
	. "github.com/metacubex/mihomo/adapter/inbound"
	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/hub/executor"
	"net"
	"net/netip"
	"sync"
	"testing"

	"github.com/metacubex/mihomo/component/auth"
)

func TestAngelaNexusAuthStateAtomicPublication(t *testing.T) {
	old := AuthSnapshotNow()
	defer func() {
		ApplyAuthState(nil, old.SkipAuthPrefixes, old.AllowedIPs, old.DisAllowedIPs)
		SetDefaultAuthenticator(old.Authenticator)
	}()
	prefixes := []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8"), netip.MustParsePrefix("192.0.2.0/24")}
	publish := func(i int) {
		p := []netip.Prefix{prefixes[i]}
		ApplyAuthState([]auth.AuthUser{{User: fmt.Sprint(i), Pass: "secret"}}, p, p, p)
	}
	publish(0)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for writer := 0; writer < 2; writer++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			for n := 0; n < 200; n++ {
				publish(i)
			}
		}(writer)
	}
	for reader := 0; reader < 4; reader++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for n := 0; n < 400; n++ {
				s := AuthSnapshotNow()
				if len(s.SkipAuthPrefixes) != 1 || len(s.AllowedIPs) != 1 || len(s.DisAllowedIPs) != 1 {
					t.Error("partial auth/filter publication")
					return
				}
				i := 0
				if s.SkipAuthPrefixes[0] == prefixes[1] {
					i = 1
				}
				if s.SkipAuthPrefixes[0] != prefixes[i] || s.AllowedIPs[0] != prefixes[i] || s.DisAllowedIPs[0] != prefixes[i] || s.Authenticator == nil || !s.Authenticator.Verify(fmt.Sprint(i), "secret") || s.Authenticator.Verify(fmt.Sprint(1-i), "secret") {
					t.Error("authentication and filters crossed configuration generations")
					return
				}
			}
		}()
	}
	close(start)
	wg.Wait()
}

func TestAngelaNexusAuthStateCopiesAndAdmission(t *testing.T) {
	old := AuthSnapshotNow()
	defer func() {
		ApplyAuthState(nil, old.SkipAuthPrefixes, old.AllowedIPs, old.DisAllowedIPs)
		SetDefaultAuthenticator(old.Authenticator)
	}()
	p := netip.MustParsePrefix("127.0.0.0/8")
	other := netip.MustParsePrefix("192.0.2.0/24")
	input := []netip.Prefix{p}
	users := []auth.AuthUser{{User: "alice", Pass: "old"}}
	ApplyAuthState(users, input, input, nil)
	input[0] = other
	users[0].Pass = "new"
	s := AuthSnapshotNow()
	if s.SkipAuthPrefixes[0] != p || s.AllowedIPs[0] != p || !s.Authenticator.Verify("alice", "old") {
		t.Fatal("publisher retained caller-owned values")
	}
	s.SkipAuthPrefixes[0] = other
	s.AllowedIPs[0] = other
	SkipAuthPrefixes()[0] = other
	AllowedIPs()[0] = other
	if now := AuthSnapshotNow(); now.SkipAuthPrefixes[0] != p || now.AllowedIPs[0] != p {
		t.Fatal("getter exposes mutable global backing storage")
	}
	addr := &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 1234}
	s = AuthSnapshotNow()
	if !IsRemoteAddrDisAllowedSnapshot(addr, s) || !SkipAuthRemoteAddrSnapshot(addr, s) {
		t.Fatal("allowed/skip snapshot rejected loopback")
	}
	SetSkipAuthPrefixes(nil)
	SetAllowedIPs([]netip.Prefix{other})
	SetDisAllowedIPs([]netip.Prefix{p})
	if !IsRemoteAddrDisAllowedSnapshot(addr, s) || !SkipAuthRemoteAddrSnapshot(addr, s) {
		t.Fatal("captured generation changed after setters")
	}
	if IsRemoteAddrDisAllowed(addr) || SkipAuthRemoteAddr(addr) {
		t.Fatal("legacy setter API does not publish new filter state")
	}
	deny := []netip.Prefix{p}
	SetDisAllowedIPs(deny)
	deny[0] = other
	DisAllowedIPs()[0] = other
	if DisAllowedIPs()[0] != p {
		t.Fatal("deny setter/getter aliases caller")
	}
}

func TestAngelaNexusAuthStateExecutorApplyAndForceFalse(t *testing.T) {
	makeConfig := func(i int) *config.Config {
		p := []string{"127.0.0.0/8", "192.0.2.0/24"}[i]
		raw := map[string]any{"mode": "rule", "log-level": "silent", "geo-auto-update": false, "rules": []string{"MATCH,DIRECT"}, "dns": map[string]bool{"enable": false}, "ntp": map[string]bool{"enable": false}, "tun": map[string]bool{"enable": false}, "authentication": []string{fmt.Sprintf("%d:secret", i)}, "skip-auth-prefixes": []string{p}, "lan-allowed-ips": []string{p}, "lan-disallowed-ips": []string{p}}
		data, err := json.Marshal(raw)
		if err != nil {
			t.Fatal(err)
		}
		cfg, err := config.Parse(data)
		if err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	a, b := makeConfig(0), makeConfig(1)
	executor.ApplyConfig(a, true)
	executor.ApplyConfig(b, false)
	s := AuthSnapshotNow()
	p := netip.MustParsePrefix("127.0.0.0/8")
	if s.Authenticator == nil || !s.Authenticator.Verify("1", "secret") || len(s.SkipAuthPrefixes) != 1 || s.SkipAuthPrefixes[0] != p || s.AllowedIPs[0] != p || s.DisAllowedIPs[0] != p {
		t.Fatal("non-forced apply changed legacy filter semantics")
	}
	executor.ApplyConfig(a, true)
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 30; i++ {
			executor.ApplyConfig([]*config.Config{a, b}[i%2], true)
		}
		close(done)
	}()
	for {
		s := AuthSnapshotNow()
		i := 0
		if s.SkipAuthPrefixes[0] == netip.MustParsePrefix("192.0.2.0/24") {
			i = 1
		}
		if s.SkipAuthPrefixes[0] != s.AllowedIPs[0] || s.AllowedIPs[0] != s.DisAllowedIPs[0] || !s.Authenticator.Verify(fmt.Sprint(i), "secret") {
			t.Error("real executor published cross-configuration auth/filter tuple")
			break
		}
		select {
		case <-done:
			wg.Wait()
			return
		default:
		}
	}
	wg.Wait()
}
