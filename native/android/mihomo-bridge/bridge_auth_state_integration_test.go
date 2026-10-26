package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"
)

func bridgeAuthConfig(t *testing.T, port int, users []string, skip, allow, deny []string) []byte {
	t.Helper()
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["mixed-port"] = port
	cfg["authentication"] = users
	if skip == nil {
		skip = []string{}
	}
	if allow == nil {
		allow = []string{"0.0.0.0/0", "::/0"}
	}
	if deny == nil {
		deny = []string{}
	}
	cfg["skip-auth-prefixes"] = skip
	cfg["lan-allowed-ips"] = allow
	cfg["lan-disallowed-ips"] = deny
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func bridgeAuthNamedConfig(t *testing.T, addr string, users any) []byte {
	t.Helper()
	host, p, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(p)
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := json.Unmarshal(bridgeConfigJSON("rule"), &cfg); err != nil {
		t.Fatal(err)
	}
	cfg["mixed-port"] = 0
	cfg["listeners"] = []any{map[string]any{"name": "android-auth-named", "type": "mixed", "listen": host, "port": port, "udp": false, "users": users}}
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func bridgeSOCKS5Auth(t *testing.T, addr, user, pass string, wantAuth bool) {
	t.Helper()
	c, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	methods := []byte{0}
	if wantAuth {
		methods = []byte{2}
	}
	if _, err = c.Write(append([]byte{5, byte(len(methods))}, methods...)); err != nil {
		t.Fatal(err)
	}
	var sel [2]byte
	if _, err = io.ReadFull(c, sel[:]); err != nil {
		t.Fatal(err)
	}
	if sel[0] != 5 || (wantAuth && sel[1] != 2) || (!wantAuth && sel[1] != 0) {
		t.Fatalf("SOCKS5 method=%v wantAuth=%v", sel, wantAuth)
	}
	if wantAuth {
		if len(user) > 255 || len(pass) > 255 {
			t.Fatal("credentials too long")
		}
		p := []byte{1, byte(len(user))}
		p = append(p, user...)
		p = append(p, byte(len(pass)))
		p = append(p, pass...)
		if _, err = c.Write(p); err != nil {
			t.Fatal(err)
		}
		var r [2]byte
		if _, err = io.ReadFull(c, r[:]); err != nil {
			t.Fatal(err)
		}
		if r[0] != 1 || r[1] != 0 {
			t.Fatalf("SOCKS5 auth rejected: %v", r)
		}
	}
}

func bridgeSOCKS5Rejected(t *testing.T, addr, user, pass string) {
	t.Helper()
	c, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	_, _ = c.Write([]byte{5, 1, 2})
	var r [2]byte
	if _, err := io.ReadFull(c, r[:]); err != nil {
		return
	}
	if r[1] != 2 {
		return
	}
	p := []byte{1, byte(len(user))}
	p = append(p, user...)
	p = append(p, byte(len(pass)))
	p = append(p, pass...)
	_, _ = c.Write(p)
	var a [2]byte
	if _, err := io.ReadFull(c, a[:]); err == nil && a[1] == 0 {
		t.Fatalf("wrong credentials accepted")
	}
}

func bridgeAuthPort(t *testing.T) string { t.Helper(); return bridgeDNSAddress(t) }

func TestAndroidBridgeAuthStateDefaultMixedAndNamedSemantics(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	addr := bridgeAuthPort(t)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	cases := []struct {
		name string
		cfg  []byte
		auth bool
	}{
		{"mixed-default", bridgeAuthConfig(t, port, []string{"alice:secret"}, nil, nil, nil), true},
		{"mixed-default-skip-auth", bridgeAuthConfig(t, port, []string{"alice:secret"}, []string{"127.0.0.1/32"}, nil, nil), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := applyAndroidConfigJSON(tc.cfg); err != nil {
				t.Fatal(err)
			}
			if tc.auth {
				bridgeSOCKS5Auth(t, addr, "alice", "secret", true)
				bridgeSOCKS5Rejected(t, addr, "alice", "bad")
			} else {
				bridgeSOCKS5Auth(t, addr, "", "", false)
			}
		})
	}
	addr = bridgeAuthPort(t)
	named := bridgeAuthNamedConfig(t, addr, []any{map[string]any{"username": "bob", "password": "pw"}})
	if err := applyAndroidConfigJSON(named); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "bob", "pw", true)
	bridgeSOCKS5Rejected(t, addr, "alice", "secret")
	empty := bridgeAuthNamedConfig(t, addr, []any{})
	if err := applyAndroidConfigJSON(empty); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "", "", false)
}

func TestAndroidBridgeAuthStatePinnedAcrossApplySameListener(t *testing.T) {
	bridgeAuthPinnedAcrossApply(t, false)
}

func TestAndroidBridgeAuthStateNamedPinnedAcrossApply(t *testing.T) {
	bridgeAuthPinnedAcrossApply(t, true)
}

func bridgeAuthPinnedAcrossApply(t *testing.T, named bool) {
	t.Helper()
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	addr := bridgeAuthPort(t)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	a := bridgeAuthConfig(t, port, []string{"alice:a"}, nil, nil, nil)
	b := bridgeAuthConfig(t, port, []string{"bob:b"}, nil, nil, nil)
	if named {
		var n map[string]any
		if err := json.Unmarshal(bridgeAuthNamedConfig(t, addr, nil), &n); err != nil {
			t.Fatal(err)
		}
		convert := func(data []byte) []byte {
			var cfg map[string]any
			if err := json.Unmarshal(data, &cfg); err != nil {
				t.Fatal(err)
			}
			cfg["mixed-port"] = 0
			cfg["listeners"] = n["listeners"]
			out, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			return out
		}
		a, b = convert(a), convert(b)
	}
	if err := applyAndroidConfigJSON(a); err != nil {
		t.Fatal(err)
	}
	c, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(time.Second))
	bridgeSOCKS5Auth(t, addr, "alice", "a", true) // later accepted peer proves idle c was admitted
	if err := applyAndroidConfigJSON(b); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Write([]byte{5, 1, 2}); err != nil {
		t.Fatal(err)
	}
	var sel [2]byte
	if _, err = io.ReadFull(c, sel[:]); err != nil {
		t.Fatal(err)
	}
	if sel != [2]byte{5, 2} {
		t.Fatalf("pinned method mismatch: %v", sel)
	}
	pld := []byte{1, 5}
	pld = append(pld, "alice"...)
	pld = append(pld, 1, 'a')
	if _, err = c.Write(pld); err != nil {
		t.Fatal(err)
	}
	var r [2]byte
	if _, err = io.ReadFull(c, r[:]); err != nil {
		t.Fatal(err)
	}
	if r[1] != 0 {
		t.Fatalf("accepted A peer used credentials from later apply: %v", r)
	}
	bridgeSOCKS5Rejected(t, addr, "alice", "a")
	bridgeSOCKS5Auth(t, addr, "bob", "b", true)
}

func TestAndroidBridgeAuthStateConcurrentApplyAndPeers(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stopTunError() }()
	addr := bridgeAuthPort(t)
	_, p, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(p)
	configs := make([][]byte, 0, 4)
	for i := 0; i < 4; i++ {
		mode := fmt.Sprintf("u%d:p%d", i, i)
		switch i % 4 {
		case 0:
			configs = append(configs, bridgeAuthConfig(t, port, []string{mode}, nil, nil, nil))
		case 1:
			configs = append(configs, bridgeAuthConfig(t, port, []string{mode}, []string{"127.0.0.1/32"}, nil, nil))
		case 2:
			configs = append(configs, bridgeAuthConfig(t, port, []string{mode}, nil, []string{"127.0.0.1/32"}, []string{"127.0.0.1/32"}))
		default:
			configs = append(configs, bridgeAuthConfig(t, port, []string{mode}, nil, nil, []string{"127.0.0.1/32"}))
		}
	}
	if err := applyAndroidConfigJSON(configs[0]); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "u0", "p0", true)
	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(5)
	go func() {
		defer wg.Done()
		<-start
		for i := 0; i < 40; i++ {
			if err := applyAndroidConfigJSON(configs[i%len(configs)]); err != nil {
				t.Errorf("apply %d: %v", i, err)
			}
		}
	}()
	for g := 0; g < 4; g++ {
		go func(g int) {
			defer wg.Done()
			<-start
			for i := 0; i < 40; i++ {
				c, e := net.DialTimeout("tcp", addr, time.Second)
				if e != nil {
					continue
				}
				_ = c.SetDeadline(time.Now().Add(time.Second))
				_, _ = c.Write([]byte{5, 1, 2})
				var x [2]byte
				_, _ = io.ReadFull(c, x[:])
				_ = c.Close()
			}
		}(g)
	}
	close(start)
	wg.Wait()
}

func TestAndroidBridgeAuthStateNamedFallbackAndExplicitIsolation(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	lastConfigJSON = nil
	if err := initializeAndroid(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := stopTunError(); err != nil {
			t.Error(err)
		}
	}()
	addr := bridgeAuthPort(t)
	build := func(users any, skip, deny []string) []byte {
		var cfg map[string]any
		if err := json.Unmarshal(bridgeAuthConfig(t, 0, []string{"alice:secret"}, skip, nil, deny), &cfg); err != nil {
			t.Fatal(err)
		}
		var named map[string]any
		if err := json.Unmarshal(bridgeAuthNamedConfig(t, addr, users), &named); err != nil {
			t.Fatal(err)
		}
		cfg["listeners"] = named["listeners"]
		b, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	if err := applyAndroidConfigJSON(build(nil, nil, nil)); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "alice", "secret", true)
	bridgeSOCKS5Rejected(t, addr, "alice", "bad")
	if err := applyAndroidConfigJSON(build(nil, []string{"127.0.0.0/8"}, nil)); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "", "", false)
	if err := applyAndroidConfigJSON(build(nil, nil, []string{"127.0.0.0/8"})); err != nil {
		t.Fatal(err)
	}
	c, err := net.DialTimeout("tcp", addr, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_ = c.SetDeadline(time.Now().Add(time.Second))
	_, _ = c.Write([]byte{5, 1, 0})
	var reply [2]byte
	_, err = io.ReadFull(c, reply[:])
	_ = c.Close()
	if err == nil {
		t.Fatal("named fallback bypassed global deny")
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatalf("deny did not actively close named peer: %v", err)
	}
	bob := []any{map[string]any{"username": "bob", "password": "pw"}}
	if err := applyAndroidConfigJSON(build(bob, nil, []string{"127.0.0.0/8"})); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "bob", "pw", true)
	bridgeSOCKS5Rejected(t, addr, "alice", "secret")
	if err := applyAndroidConfigJSON(build([]any{}, nil, []string{"127.0.0.0/8"})); err != nil {
		t.Fatal(err)
	}
	bridgeSOCKS5Auth(t, addr, "", "", false)
}
