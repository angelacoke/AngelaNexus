package dhcp

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"sync"
	"testing"
	"time"

	"github.com/insomniacslk/dhcp/dhcpv4"
)

type discoveryGatePacket struct {
	entered        chan struct{}
	release        chan struct{}
	closed         chan struct{}
	exited         chan struct{}
	enterOnce      sync.Once
	closeOnce      sync.Once
	unblockOnClose bool
	writeErr       error
}

func (p *discoveryGatePacket) ReadFrom([]byte) (int, net.Addr, error) {
	p.enterOnce.Do(func() { close(p.entered) })
	<-p.release
	close(p.exited)
	return 0, nil, net.ErrClosed
}
func (p *discoveryGatePacket) WriteTo(b []byte, _ net.Addr) (int, error) { return len(b), p.writeErr }
func (p *discoveryGatePacket) Close() error {
	p.closeOnce.Do(func() {
		close(p.closed)
		if p.unblockOnClose {
			close(p.release)
		}
	})
	return nil
}
func (p *discoveryGatePacket) LocalAddr() net.Addr {
	return &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 68}
}
func (p *discoveryGatePacket) SetDeadline(time.Time) error      { return nil }
func (p *discoveryGatePacket) SetReadDeadline(time.Time) error  { return nil }
func (p *discoveryGatePacket) SetWriteDeadline(time.Time) error { return nil }
func discoveryWait(t *testing.T, ch <-chan struct{}, name string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatalf("timed out waiting for %s", name)
	}
}
func discoveryFixture(t *testing.T, unblock bool) *discoveryGatePacket {
	t.Helper()
	return &discoveryGatePacket{entered: make(chan struct{}), release: make(chan struct{}), closed: make(chan struct{}), exited: make(chan struct{}), unblockOnClose: unblock}
}
func discoveryRequest(t *testing.T) *dhcpv4.DHCPv4 {
	t.Helper()
	m, err := dhcpv4.NewDiscovery(net.HardwareAddr{2, 0, 0, 0, 0, 1})
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestAngelaNexusDHCPDiscoveryCancellationClosesAndJoinsReceiver(t *testing.T) {
	p := discoveryFixture(t, true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	errCh := make(chan error, 1)
	q := discoveryRequest(t)
	go func() {
		defer close(done)
		_, err := exchangeDNSFromDHCP(ctx, p, q, make(chan []netip.Addr, 1))
		errCh <- err
	}()
	discoveryWait(t, p.entered, "DHCP receiver read")
	cancel()
	discoveryWait(t, done, "DHCP exchange exit")
	select {
	case <-p.exited:
	default:
		t.Fatal("discovery returned before receiver exited")
	}
	if err := <-errCh; !errors.Is(err, ErrNotResponding) {
		t.Fatalf("canceled discovery: %v", err)
	}
}

func TestAngelaNexusDHCPDiscoveryIgnoredCloseRetainsReceiverUntilExit(t *testing.T) {
	for _, writeFailure := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "write-failure"}[writeFailure], func(t *testing.T) {
			p := discoveryFixture(t, false)
			if writeFailure {
				p.writeErr = errors.New("injected DHCP write failure")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan struct{})
			q := discoveryRequest(t)
			var once sync.Once
			release := func() { once.Do(func() { close(p.release) }) }
			t.Cleanup(func() { cancel(); release(); discoveryWait(t, done, "DHCP cleanup") })
			go func() { defer close(done); _, _ = exchangeDNSFromDHCP(ctx, p, q, make(chan []netip.Addr, 1)) }()
			discoveryWait(t, p.entered, "blocked DHCP receiver")
			cancel()
			discoveryWait(t, p.closed, "DHCP close attempt")
			select {
			case <-done:
				t.Fatal("discovery returned while its receiver ignored Close")
			case <-time.After(10 * time.Millisecond):
			}
			release()
			discoveryWait(t, done, "DHCP receiver join retry")
			discoveryWait(t, p.exited, "DHCP receiver completion")
		})
	}
}
