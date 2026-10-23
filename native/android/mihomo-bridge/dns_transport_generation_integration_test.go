package dns

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	N "github.com/metacubex/mihomo/common/net"
	C "github.com/metacubex/mihomo/constant"
	"github.com/metacubex/tls"
	D "github.com/miekg/dns"
)

// A real DNS wire exchange runs over net.Pipe, but Read and Close deliberately
// violate normal wakeup behavior. A deadline cannot make these tests pass.
type transportGenerationConn struct {
	net.Conn
	entered   chan struct{}
	release   chan struct{}
	closed    chan struct{}
	once      sync.Once
	closeOnce sync.Once
}

func (c *transportGenerationConn) Read(b []byte) (int, error) {
	c.once.Do(func() { close(c.entered) })
	<-c.release
	return c.Conn.Read(b)
}
func (c *transportGenerationConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return nil
}
func (c *transportGenerationConn) SetDeadline(time.Time) error      { return nil }
func (c *transportGenerationConn) SetReadDeadline(time.Time) error  { return nil }
func (c *transportGenerationConn) SetWriteDeadline(time.Time) error { return nil }

type transportGenerationProxy struct {
	C.ProxyAdapter
	conn        net.Conn
	dialEntered chan struct{}
	dialRelease chan struct{}
	dialOnce    sync.Once
	packets     atomic.Int32
}

func (p *transportGenerationProxy) Name() string                  { return "generation-wire-gate" }
func (p *transportGenerationProxy) Type() C.AdapterType           { return C.Direct }
func (p *transportGenerationProxy) IsL3Protocol(*C.Metadata) bool { return false }
func (p *transportGenerationProxy) SupportUDP() bool              { return true }

type transportGenerationTCP struct{ N.ExtendedConn }

func (c *transportGenerationTCP) Chains() C.Chain               { return C.Chain{"generation-wire-gate"} }
func (c *transportGenerationTCP) ProviderChains() C.Chain       { return nil }
func (c *transportGenerationTCP) AppendToChains(C.ProxyAdapter) {}
func (c *transportGenerationTCP) RemoteDestination() string     { return "127.0.0.1" }

type transportGenerationPacket struct{ N.EnhancePacketConn }

func (c *transportGenerationPacket) Chains() C.Chain                               { return C.Chain{"generation-wire-gate"} }
func (c *transportGenerationPacket) ProviderChains() C.Chain                       { return nil }
func (c *transportGenerationPacket) AppendToChains(C.ProxyAdapter)                 {}
func (c *transportGenerationPacket) RemoteDestination() string                     { return "127.0.0.1" }
func (c *transportGenerationPacket) ResolveUDP(context.Context, *C.Metadata) error { return nil }

func (p *transportGenerationProxy) DialContext(context.Context, *C.Metadata) (C.Conn, error) {
	if p.dialEntered != nil {
		p.dialOnce.Do(func() { close(p.dialEntered) })
		<-p.dialRelease
	}
	return &transportGenerationTCP{N.NewExtendedConn(p.conn)}, nil
}
func (p *transportGenerationProxy) ListenPacketContext(context.Context, *C.Metadata) (C.PacketConn, error) {
	if p.packets.Add(1) > 1 {
		return nil, errors.New("deliberate QUIC probe refusal")
	}
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	return &transportGenerationPacket{EnhancePacketConn: N.NewEnhancePacketConn(pc)}, nil
}
func transportGenerationProxyFor(c net.Conn) *transportGenerationProxy {
	return &transportGenerationProxy{conn: c}
}
func transportGenerationContext() (*resolverGeneration, context.Context) {
	g := newResolverGeneration()
	return g, context.WithValue(g.ctx, resolverGenerationKey{}, g)
}
func transportGenerationWait(t *testing.T, g *resolverGeneration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := g.wait(ctx); err != nil {
		t.Fatal(err)
	}
}
func transportGenerationDebt(t *testing.T, g *resolverGeneration) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := g.wait(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("internal worker escaped generation debt: %v", err)
	}
}
func transportGenerationWire(t *testing.T) (*transportGenerationConn, func()) {
	t.Helper()
	local, peer := net.Pipe()
	gate := &transportGenerationConn{Conn: local, entered: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{})}
	var release sync.Once
	unblock := func() { release.Do(func() { close(gate.release) }) }
	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		wire := &D.Conn{Conn: peer}
		q, err := wire.ReadMsg()
		if err != nil {
			return
		}
		_ = wire.WriteMsg(generationAnswer(q, "192.0.2.77"))
	}()
	t.Cleanup(func() {
		unblock()
		_ = local.Close()
		_ = peer.Close()
		generationWait(t, serverDone, "DNS wire server exit")
	})
	return gate, unblock
}

func TestAngelaNexusDNSTransportGenerationTCPInnerExchangeRetainsDebt(t *testing.T) {
	conn, release := transportGenerationWire(t)
	g, ctx := transportGenerationContext()
	t.Cleanup(func() { g.stop(); release(); transportGenerationWait(t, g) })
	proxy := transportGenerationProxyFor(conn)
	c := newClient("127.0.0.1:53", nil, "tcp", nil, proxy, "")
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, err := c.ExchangeContext(ctx, generationQuery())
		if !errors.Is(err, context.Canceled) {
			t.Errorf("TCP outer cancellation: %v", err)
		}
	}()
	generationWait(t, conn.entered, "TCP inner wire read")
	g.stop()
	generationWait(t, done, "TCP outer return")
	generationWait(t, conn.closed, "TCP cancel Close")
	transportGenerationDebt(t, g)
	release()
	transportGenerationWait(t, g)
}

func TestAngelaNexusDNSTransportGenerationDoTLateReplyCannotRepool(t *testing.T) {
	conn, release := transportGenerationWire(t)
	g, ctx := transportGenerationContext()
	c := &dnsOverTLS{host: "127.0.0.1", port: "853"}
	c.connections.PushBack(conn)
	t.Cleanup(func() { g.stop(); release(); transportGenerationWait(t, g) })
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, err := c.ExchangeContext(ctx, generationQuery())
		if !errors.Is(err, context.Canceled) {
			t.Errorf("DoT outer cancellation: %v", err)
		}
	}()
	generationWait(t, conn.entered, "DoT inner wire read")
	g.stop()
	generationWait(t, done, "DoT outer return")
	transportGenerationDebt(t, g)
	release()
	transportGenerationWait(t, g)
	generationWait(t, conn.closed, "late DoT connection close")
	c.access.Lock()
	defer c.access.Unlock()
	if c.connections.Len() != 0 {
		t.Fatal("late DoT success was published to a retired pool")
	}
}

func TestAngelaNexusDNSTransportGenerationDoTPositiveWireReuse(t *testing.T) {
	conn, release := transportGenerationWire(t)
	g, ctx := transportGenerationContext()
	c := &dnsOverTLS{host: "127.0.0.1", port: "853"}
	c.connections.PushBack(conn)
	t.Cleanup(func() { g.stop(); release(); transportGenerationWait(t, g) })
	release()
	m, err := c.ExchangeContext(ctx, generationQuery())
	if err != nil || m.Answer[0].(*D.A).A.String() != "192.0.2.77" {
		t.Fatalf("positive DoT wire: %v %v", m, err)
	}
	c.access.Lock()
	n := c.connections.Len()
	c.access.Unlock()
	if n != 1 {
		t.Fatal("active generation lost normal connection reuse")
	}
	g.stop()
	transportGenerationWait(t, g)
}

func TestAngelaNexusDNSTransportGenerationRcodeEarlyReturnStillOwnsLaunchedClient(t *testing.T) {
	g, ctx := transportGenerationContext()
	c := generationGate(true)
	var once sync.Once
	release := func() { once.Do(func() { close(c.release) }) }
	t.Cleanup(func() { g.stop(); release(); transportGenerationWait(t, g) })
	m, _, err := batchExchange(ctx, []dnsClient{c, newRCodeClient("refused")}, generationQuery())
	if err != nil || m.Rcode != D.RcodeRefused {
		t.Fatalf("rcode positive control: %v %v", m, err)
	}
	generationWait(t, c.entered, "early-return worker")
	generationWait(t, c.canceled, "picker cancellation")
	g.stop()
	transportGenerationDebt(t, g)
	release()
	transportGenerationWait(t, g)
}

func TestAngelaNexusDNSTransportGenerationDHCPRefreshCannotPublishLateDiscovery(t *testing.T) {
	g, ctx := transportGenerationContext()
	d := newDHCPClient("scoped-discovery-test")
	entered := make(chan struct{})
	canceled := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(func() { g.stop(); unblock(); transportGenerationWait(t, g) })
	discover := func(ctx context.Context, _ string) ([]netip.Addr, error) {
		close(entered)
		<-ctx.Done()
		close(canceled)
		<-release
		return []netip.Addr{netip.MustParseAddr("192.0.2.53")}, nil
	}
	d.lock.Lock()
	d.startRefresh(ctx, discover)
	d.lock.Unlock()
	generationWait(t, entered, "DHCP discovery")
	g.stop()
	generationWait(t, canceled, "DHCP generation cancellation")
	transportGenerationDebt(t, g)
	unblock()
	transportGenerationWait(t, g)
	d.lock.Lock()
	defer d.lock.Unlock()
	if len(d.clients) != 0 || d.done != nil || !errors.Is(d.err, context.Canceled) {
		t.Fatalf("late DHCP discovery published state: clients=%d done=%v err=%v", len(d.clients), d.done, d.err)
	}
}

func TestAngelaNexusDNSTransportGenerationDHCPRefreshPositivePublication(t *testing.T) {
	g, ctx := transportGenerationContext()
	d := newDHCPClient("scoped-positive-test")
	d.lock.Lock()
	d.startRefresh(ctx, func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("192.0.2.53")}, nil
	})
	done := d.done
	d.lock.Unlock()
	generationWait(t, done, "positive DHCP publication")
	d.lock.Lock()
	n, err := len(d.clients), d.err
	d.lock.Unlock()
	if n != 1 || err != nil {
		t.Fatalf("active discovery failed to publish: %d %v", n, err)
	}
	g.stop()
	transportGenerationWait(t, g)
}

func TestAngelaNexusDNSTransportGenerationDoHProbeSiblingRetainsDebt(t *testing.T) {
	g, ctx := transportGenerationContext()
	local, peer := net.Pipe()
	proxy := transportGenerationProxyFor(local)
	proxy.dialEntered = make(chan struct{})
	proxy.dialRelease = make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(proxy.dialRelease) }) }
	t.Cleanup(func() { g.stop(); release(); _ = local.Close(); _ = peer.Close(); transportGenerationWait(t, g) })
	u, _ := url.Parse("https://127.0.0.1:443/dns-query")
	doh := &dnsOverHTTPS{url: u, addr: u.String(), dialer: newDNSDialer(nil, proxy, ""), httpVersions: []C.HTTPVersion{C.HTTPVersion2, C.HTTPVersion3}}
	done := make(chan struct{})
	go func() { defer close(done); _, _ = doh.probeH3(ctx, &tls.Config{InsecureSkipVerify: true}) }()
	generationWait(t, proxy.dialEntered, "TLS sibling dial")
	generationWait(t, done, "QUIC-refused probe parent return")
	g.stop()
	transportGenerationDebt(t, g)
	release()
	transportGenerationWait(t, g)
}

func TestAngelaNexusDNSTransportGenerationSealedTaskDoesNotLaunchOrPublish(t *testing.T) {
	g, ctx := transportGenerationContext()
	g.stop()
	ran := atomic.Bool{}
	if startResolverTask(ctx, func(context.Context) { ran.Store(true) }) {
		t.Fatal("stopped generation launched an internal worker")
	}
	if commitResolverTask(ctx, func() { ran.Store(true) }) || ran.Load() {
		t.Fatal("stopped generation published transport state")
	}
	transportGenerationWait(t, g)
}

var _ io.ReadWriteCloser = (*transportGenerationConn)(nil)
