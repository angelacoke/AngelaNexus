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

type generationGateClient struct {
	entered      chan struct{}
	canceled     chan struct{}
	release      chan struct{}
	ignoreCancel bool
	enteredOnce  sync.Once
	canceledOnce sync.Once
	calls        atomic.Int32
	address      string
}

func (c *generationGateClient) Address() string  { return "resolver-generation-gate" }
func (c *generationGateClient) ResetConnection() {}
func (c *generationGateClient) ExchangeContext(ctx context.Context, q *D.Msg) (*D.Msg, error) {
	c.calls.Add(1)
	c.enteredOnce.Do(func() { close(c.entered) })
	<-ctx.Done()
	c.canceledOnce.Do(func() { close(c.canceled) })
	if !c.ignoreCancel {
		return nil, ctx.Err()
	}
	<-c.release
	return generationAnswer(q, c.address), nil
}
func generationGate(ignore bool) *generationGateClient {
	return &generationGateClient{entered: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{}), ignoreCancel: ignore, address: "192.0.2.7"}
}
func generationAnswer(q *D.Msg, address string) *D.Msg {
	m := new(D.Msg)
	m.SetReply(q)
	if q.Question[0].Qtype == D.TypeAAAA {
		m.Answer = []D.RR{&D.AAAA{Hdr: D.RR_Header{Name: q.Question[0].Name, Rrtype: D.TypeAAAA, Class: D.ClassINET, Ttl: 60}, AAAA: net.ParseIP("2001:db8::7")}}
	} else {
		m.Answer = []D.RR{&D.A{Hdr: D.RR_Header{Name: q.Question[0].Name, Rrtype: D.TypeA, Class: D.ClassINET, Ttl: 60}, A: net.ParseIP(address)}}
	}
	return m
}

type generationImmediateClient struct {
	calls   atomic.Int32
	before  func()
	address string
}

func (c *generationImmediateClient) Address() string  { return "resolver-generation-positive" }
func (c *generationImmediateClient) ResetConnection() {}
func (c *generationImmediateClient) ExchangeContext(_ context.Context, q *D.Msg) (*D.Msg, error) {
	c.calls.Add(1)
	if c.before != nil {
		c.before()
	}
	return generationAnswer(q, c.address), nil
}
func generationQuery() *D.Msg {
	m := new(D.Msg)
	m.SetQuestion("generation.angelanexus.test.", D.TypeA)
	return m
}
func generationWait(t *testing.T, ch <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}
func generationJoin(t *testing.T, rs Resolvers) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := rs.Wait(ctx); err != nil {
		t.Fatalf("generation join: %v", err)
	}
}
func generationDebt(t *testing.T, rs Resolvers) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := rs.Wait(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unjoined worker lost timeout debt: %v", err)
	}
}
func generationCleanup(t *testing.T, rs Resolvers, c *generationGateClient) func() {
	var once sync.Once
	release := func() { once.Do(func() { close(c.release) }) }
	t.Cleanup(func() { rs.Cancel(); release(); generationJoin(t, rs) })
	return release
}

func TestAngelaNexusDNSResolverStopCancelsAndJoinsRequests(t *testing.T) {
	c := generationGate(false)
	rs := Resolvers{Resolver: NewResolverFromClient(c)}
	generationCleanup(t, rs, c)
	done := make(chan struct{})
	go func() {
		defer close(done)
		m, err := rs.ExchangeContext(context.Background(), generationQuery())
		if m != nil || !errors.Is(err, context.Canceled) {
			t.Errorf("canceled request: %v, %v", m, err)
		}
	}()
	generationWait(t, c.entered, "query entry")
	rs.Cancel()
	generationWait(t, c.canceled, "generation cancellation (not DNS timeout)")
	generationJoin(t, rs)
	generationWait(t, done, "request exit")
	if m, err := rs.ExchangeContext(context.Background(), generationQuery()); m != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("stopped generation accepted request: %v %v", m, err)
	}
	if c.calls.Load() != 1 {
		t.Fatal("stop started a detached refresh or retry")
	}
}

func TestAngelaNexusDNSResolverLateSuccessCannotPopulateCacheOrFreshGeneration(t *testing.T) {
	c := generationGate(true)
	old := Resolvers{Resolver: NewResolverFromClient(c)}
	release := generationCleanup(t, old, c)
	done := make(chan struct{})
	go func() {
		defer close(done)
		m, err := old.ExchangeContext(context.Background(), generationQuery())
		if m != nil || !errors.Is(err, context.Canceled) {
			t.Errorf("late success published: %v %v", m, err)
		}
	}()
	generationWait(t, c.entered, "late query entry")
	old.Cancel()
	generationWait(t, c.canceled, "late client cancellation")
	generationDebt(t, old)
	positive := &generationImmediateClient{address: "192.0.2.99"}
	fresh := Resolvers{Resolver: NewResolverFromClient(positive)}
	t.Cleanup(func() { fresh.Cancel(); generationJoin(t, fresh) })
	for i := 0; i < 2; i++ {
		m, err := fresh.ExchangeContext(context.Background(), generationQuery())
		if err != nil || m.Answer[0].(*D.A).A.String() != "192.0.2.99" {
			t.Fatalf("fresh positive: %v %v", m, err)
		}
	}
	if positive.calls.Load() != 1 {
		t.Fatal("positive control did not cache a real TTL-bearing answer")
	}
	release()
	generationJoin(t, old)
	generationWait(t, done, "late caller exit")
	if _, _, hit := getMsgFromCache(old.cache, generationQuery().Question[0]); hit {
		t.Fatal("late success populated stopped cache")
	}
	m, err := fresh.ExchangeContext(context.Background(), generationQuery())
	if err != nil || m.Answer[0].(*D.A).A.String() != "192.0.2.99" || positive.calls.Load() != 1 {
		t.Fatalf("old generation contaminated fresh cache: %v %v", m, err)
	}
}

func TestAngelaNexusDNSResolverStaleRefreshIsCanceledAndJoined(t *testing.T) {
	c := generationGate(true)
	rs := Resolvers{Resolver: NewResolverFromClient(c)}
	release := generationCleanup(t, rs, c)
	q := generationQuery()
	rs.cache.SetWithExpire(q.Question[0].String(), generationAnswer(q, "192.0.2.55"), time.Now().Add(-time.Second))
	m, err := rs.ExchangeContext(context.Background(), q)
	if err != nil || m.Answer[0].(*D.A).A.String() != "192.0.2.55" {
		t.Fatalf("stale positive control: %v %v", m, err)
	}
	generationWait(t, c.entered, "detached stale-cache refresh")
	rs.Cancel()
	generationWait(t, c.canceled, "refresh cancellation")
	generationDebt(t, rs)
	release()
	generationJoin(t, rs)
	cached, _, hit := getMsgFromCache(rs.cache, q.Question[0])
	if !hit || cached.Answer[0].(*D.A).A.String() != "192.0.2.55" {
		t.Fatal("stopped refresh replaced stale cache")
	}
}

type generationDualClient struct{ v6 *generationGateClient }

func (c generationDualClient) Address() string  { return "resolver-dual" }
func (c generationDualClient) ResetConnection() {}
func (c generationDualClient) ExchangeContext(ctx context.Context, q *D.Msg) (*D.Msg, error) {
	if q.Question[0].Qtype == D.TypeAAAA {
		return c.v6.ExchangeContext(ctx, q)
	}
	<-c.v6.entered
	return generationAnswer(q, "192.0.2.8"), nil
}
func TestAngelaNexusDNSResolverEarlyIPv4ReturnStillOwnsAAAAWorker(t *testing.T) {
	c := generationGate(true)
	rs := Resolvers{Resolver: NewResolverFromClient(generationDualClient{c})}
	release := generationCleanup(t, rs, c)
	ips, err := rs.LookupIPPrimaryIPv4(context.Background(), "dual.angelanexus.test")
	if err != nil || len(ips) != 1 || ips[0].String() != "192.0.2.8" {
		t.Fatalf("early IPv4 positive: %v %v", ips, err)
	}
	rs.Cancel()
	generationWait(t, c.canceled, "AAAA cancellation")
	generationDebt(t, rs)
	release()
	generationJoin(t, rs)
}
func TestAngelaNexusDNSResolverEarlyMainReturnStillOwnsFallbackWorker(t *testing.T) {
	fallback := generationGate(true)
	main := &generationImmediateClient{address: "192.0.2.8", before: func() { <-fallback.entered }}
	rs := Resolvers{Resolver: &Resolver{main: []dnsClient{main}, fallback: []dnsClient{fallback}, cache: Config{}.newCache()}}
	release := generationCleanup(t, rs, fallback)
	m, err := rs.ExchangeContext(context.Background(), generationQuery())
	if err != nil || m.Answer[0].(*D.A).A.String() != "192.0.2.8" {
		t.Fatalf("early main positive: %v %v", m, err)
	}
	rs.Cancel()
	generationWait(t, fallback.canceled, "fallback cancellation")
	generationDebt(t, rs)
	release()
	generationJoin(t, rs)
}
func TestAngelaNexusDNSResolverCallerCancellationOwnsDetachedWork(t *testing.T) {
	c := generationGate(true)
	rs := Resolvers{Resolver: NewResolverFromClient(c)}
	release := generationCleanup(t, rs, c)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); _, _ = rs.ExchangeContext(ctx, generationQuery()) }()
	generationWait(t, c.entered, "caller query")
	cancel()
	generationWait(t, done, "caller cancellation return")
	rs.Cancel()
	generationWait(t, c.canceled, "detached work cancellation")
	generationDebt(t, rs)
	release()
	generationJoin(t, rs)
}
func TestAngelaNexusDNSResolverCancelsAllRootsAndDefaultDependencies(t *testing.T) {
	clients := []*generationGateClient{generationGate(false), generationGate(false), generationGate(false), generationGate(false)}
	roots := make([]*Resolver, 4)
	for i, c := range clients {
		roots[i] = NewResolverFromClient(c)
	}
	roots[0].defaultResolver = roots[3]
	roots[3].defaultResolver = roots[0] // Deduplicate cycles and shared dependencies.
	rs := Resolvers{Resolver: roots[0], ProxyResolver: roots[1], DirectResolver: roots[2]}
	t.Cleanup(func() { rs.Cancel(); generationJoin(t, rs) })
	for i, r := range roots {
		go func(r *Resolver) { _, _ = r.ExchangeContext(context.Background(), generationQuery()) }(r)
		generationWait(t, clients[i].entered, "root query")
	}
	rs.Cancel()
	for _, c := range clients {
		generationWait(t, c.canceled, "root cancellation")
	}
	generationJoin(t, rs)
	for _, r := range roots {
		if _, err := r.ExchangeContext(context.Background(), generationQuery()); !errors.Is(err, context.Canceled) {
			t.Fatalf("root remained active: %v", err)
		}
	}
}
func TestAngelaNexusDNSResolverConcurrentLiteralInitializationAndStop(t *testing.T) {
	c := &generationImmediateClient{address: "192.0.2.8"}
	r := &Resolver{main: []dnsClient{c}, cache: Config{}.newCache()}
	rs := Resolvers{Resolver: r}
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; _, _ = r.ExchangeContext(context.Background(), generationQuery()) }()
	}
	close(start)
	rs.Cancel()
	generationJoin(t, rs)
	wg.Wait()
	if _, err := r.LookupIPv4(context.Background(), "192.0.2.8"); !errors.Is(err, context.Canceled) {
		t.Fatalf("literal IP bypassed stopped generation: %v", err)
	}
}

func TestAngelaNexusDNSResolverCacheCommitSealedAgainstLateWorker(t *testing.T) {
	r := NewResolverFromClient(&generationImmediateClient{address: "192.0.2.8"})
	g := r.resolverGeneration()
	q := generationQuery()
	g.put(r.cache, q.Question[0], generationAnswer(q, "192.0.2.8"))
	if _, _, hit := getMsgFromCache(r.cache, q.Question[0]); !hit {
		t.Fatal("active-generation cache commit positive control failed")
	}
	r.cache.Clear()
	g.stop()
	g.put(r.cache, q.Question[0], generationAnswer(q, "192.0.2.7"))
	if _, _, hit := getMsgFromCache(r.cache, q.Question[0]); hit {
		t.Fatal("sealed generation committed a late TTL-bearing answer")
	}
}

func TestAngelaNexusDNSResolverRepeatedWaitTimeoutRetainsSameDebt(t *testing.T) {
	g := newResolverGeneration()
	if err := g.begin(); err != nil {
		t.Fatal(err)
	}
	g.stop()
	done := g.done
	for i := 0; i < 5; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := g.wait(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("wait lost debt: %v", err)
		}
		if g.done != done {
			t.Fatal("retry replaced the owned completion barrier")
		}
	}
	g.end()
	if err := g.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := g.begin(); !errors.Is(err, context.Canceled) {
		t.Fatal("successful retry reopened a stopped generation")
	}
}

func TestAngelaNexusDNSResolverConstructorSharesGenerationAcrossAllRoots(t *testing.T) {
	rs := NewResolver(Config{Main: []NameServer{{Net: "rcode", Addr: "refused"}}, Default: []NameServer{{Addr: "127.0.0.1:53"}}, ProxyServer: []NameServer{{Net: "rcode", Addr: "refused"}}, DirectServer: []NameServer{{Net: "rcode", Addr: "refused"}}})
	if len(rs.generations()) != 1 {
		t.Fatalf("constructor did not share generation ownership: %d", len(rs.generations()))
	}
	rs.Cancel()
	generationJoin(t, rs)
	for _, r := range []*Resolver{rs.Resolver, rs.ProxyResolver, rs.DirectResolver, rs.Resolver.defaultResolver} {
		if r == nil {
			t.Fatal("positive fixture omitted a root")
		}
		if _, err := r.ExchangeContext(context.Background(), generationQuery()); !errors.Is(err, context.Canceled) {
			t.Fatalf("constructor root escaped cancellation: %v", err)
		}
	}
}
