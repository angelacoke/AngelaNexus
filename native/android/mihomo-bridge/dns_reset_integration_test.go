package dns

import (
	"context"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	D "github.com/miekg/dns"
)

type angelanexusMatcherFunc func(string) bool

func (f angelanexusMatcherFunc) MatchDomain(s string) bool { return f(s) }

type angelanexusResetClient struct {
	count *atomic.Int32
	data  []byte
}

func (c angelanexusResetClient) ExchangeContext(context.Context, *D.Msg) (*D.Msg, error) {
	return new(D.Msg), nil
}
func (c angelanexusResetClient) Address() string  { return "test" }
func (c angelanexusResetClient) ResetConnection() { c.count.Add(1) }

func angelanexusRawClient(c dnsClient) dnsClient {
	for {
		u, ok := c.(interface{ Unwrap() dnsClient })
		if !ok {
			return c
		}
		c = u.Unwrap()
	}
}

func TestAngelaNexusDNSResetPolicyOnlyDoH(t *testing.T) {
	for _, kind := range []string{"trie", "matcher", "proxy-policy", "direct-follow"} {
		t.Run(kind, func(t *testing.T) {
			var requests, connections atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload []byte
				var err error
				if encoded := r.URL.Query().Get("dns"); encoded != "" {
					payload, err = base64.RawURLEncoding.DecodeString(encoded)
				} else {
					payload, err = io.ReadAll(r.Body)
				}
				if err != nil {
					t.Errorf("read DoH request: %v", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				query := new(D.Msg)
				if err = query.Unpack(payload); err != nil || len(query.Question) != 1 {
					t.Errorf("invalid DNS query: %v", err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				requests.Add(1)
				answer := new(D.Msg)
				answer.SetReply(query)
				answer.Answer = []D.RR{&D.A{Hdr: D.RR_Header{Name: query.Question[0].Name, Rrtype: D.TypeA, Class: D.ClassINET, Ttl: 60}, A: net.IPv4(192, 0, 2, 1)}}
				body, err := answer.Pack()
				if err != nil {
					t.Errorf("pack response: %v", err)
					return
				}
				w.Header().Set("content-type", "application/dns-message")
				_, _ = w.Write(body)
			}))
			server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
				if state == http.StateNew {
					connections.Add(1)
				}
			}
			server.StartTLS()
			t.Cleanup(server.Close)

			// Main is a separate, network-free client: it must not accidentally
			// reset a raw transport shared with the policy and hide the old bug.
			main := []NameServer{{Net: "rcode", Addr: "refused"}}
			policy := Policy{Domain: "policy.angelanexus.test", NameServers: []NameServer{{Net: "https", Addr: server.URL + "/dns-query", Params: map[string]string{"skip-cert-verify": "true", "disable-ipv6": "true"}}}}
			cfg := Config{Main: main, Policy: []Policy{policy}}
			switch kind {
			case "matcher":
				cfg.Policy[0].Matcher = angelanexusMatcherFunc(func(name string) bool { return name == policy.Domain })
			case "proxy-policy":
				cfg.Policy = nil
				cfg.ProxyServer, cfg.ProxyServerPolicy = main, []Policy{policy}
			case "direct-follow":
				cfg.DirectServer, cfg.DirectFollowPolicy = main, true
			}
			rs := NewResolver(cfg)
			r := rs.Resolver
			if kind == "proxy-policy" {
				r = rs.ProxyResolver
			} else if kind == "direct-follow" {
				r = rs.DirectResolver
			}
			if r == nil || len(r.policy) != 1 {
				t.Fatal("constructor did not install selected policy")
			}
			clients := r.policy[0].Match(policy.Domain)
			if len(clients) != 1 {
				t.Fatal("constructed policy did not match")
			}
			raw, ok := angelanexusRawClient(clients[0]).(*dnsOverHTTPS)
			if !ok {
				t.Fatalf("raw policy client = %T, want DoH", angelanexusRawClient(clients[0]))
			}
			t.Cleanup(func() { _ = raw.Close() })
			lookup := func() {
				t.Helper()
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				ips, err := r.LookupIPv4(ctx, policy.Domain)
				if err != nil || len(ips) != 1 || ips[0] != netip.MustParseAddr("192.0.2.1") {
					t.Fatalf("policy lookup = %v, %v", ips, err)
				}
			}
			lookup()
			raw.clientMu.Lock()
			before := raw.client
			raw.clientMu.Unlock()
			if before == nil {
				t.Fatal("first query did not establish DoH transport")
			}
			r.ResetConnection()
			raw.clientMu.Lock()
			afterReset := raw.client
			raw.clientMu.Unlock()
			if afterReset != nil {
				t.Fatal("policy-only DoH transport survived reset")
			}
			r.ClearCache()
			lookup()
			raw.clientMu.Lock()
			afterQuery := raw.client
			raw.clientMu.Unlock()
			if afterQuery == nil || afterQuery == before || requests.Load() != 2 || connections.Load() != 2 {
				t.Fatalf("reset did not recreate TLS transport: requests=%d connections=%d", requests.Load(), connections.Load())
			}
		})
	}
}

func TestAngelaNexusDNSResetFakeCoverageAndDedup(t *testing.T) {
	var shared, fallback, policy, bootstrap atomic.Int32
	main := &angelanexusResetClient{count: &shared}
	fallbackClient := &angelanexusResetClient{count: &fallback}
	policyClient := &angelanexusResetClient{count: &policy}
	bootstrapClient := &angelanexusResetClient{count: &bootstrap}
	r := &Resolver{main: []dnsClient{main}, fallback: []dnsClient{fallbackClient}, policyClients: []dnsClient{policyClient}, defaultResolver: &Resolver{main: []dnsClient{bootstrapClient}, policyClients: []dnsClient{main, policyClient}}}
	for i := int32(1); i <= 2; i++ {
		r.ResetConnection()
		if shared.Load() != i || fallback.Load() != i || policy.Load() != i || bootstrap.Load() != i {
			t.Fatalf("reset %d counts main=%d fallback=%d policy=%d bootstrap=%d", i, shared.Load(), fallback.Load(), policy.Load(), bootstrap.Load())
		}
	}
	var incomparable atomic.Int32
	bad := angelanexusResetClient{count: &incomparable, data: []byte{1}}
	r.policyClients = []dnsClient{bad, bad}
	r.ResetConnection()
	if incomparable.Load() != 2 {
		t.Fatalf("incomparable custom client reset count = %d, want 2", incomparable.Load())
	}
	var nilResolver *Resolver
	nilResolver.ResetConnection()
	Resolvers{}.ResetConnection()
}

func TestAngelaNexusDNSResetSharedWrappedTransport(t *testing.T) {
	var count atomic.Int32
	raw := &angelanexusResetClient{count: &count}
	first := rewrapClient(raw, map[string]string{"disable-ipv6": "true", "ecs": "192.0.2.0/24"})
	second := rewrapClient(raw, map[string]string{"disable-qtype-65": "true"})
	rs := Resolvers{
		Resolver:       &Resolver{main: []dnsClient{raw}, fallback: []dnsClient{second}, policyClients: []dnsClient{first, first}},
		ProxyResolver:  &Resolver{policyClients: []dnsClient{second}},
		DirectResolver: &Resolver{policyClients: []dnsClient{first}},
	}
	for i := int32(1); i <= 2; i++ {
		rs.ResetConnection()
		if got := count.Load(); got != i {
			t.Fatalf("shared wrapped transport reset count = %d, want %d", got, i)
		}
	}
}
