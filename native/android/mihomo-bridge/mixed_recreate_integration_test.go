package listener

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
	"github.com/metacubex/mihomo/listener/mixed"
	"github.com/metacubex/mihomo/listener/socks"
)

type mixedRecreateConfig struct {
	C.InboundListenConfig
	listener net.Listener
}

func (c mixedRecreateConfig) Listen(context.Context, string, string) (net.Listener, error) {
	return c.listener, nil
}

type mixedRecreateCloseFailure struct {
	net.Listener
	fail atomic.Bool
}

func (l *mixedRecreateCloseFailure) Close() error {
	if l.fail.Load() {
		return errors.New("mixed recreate close refused")
	}
	return l.Listener.Close()
}

func TestAngelaNexusMixedRecreateRetainsFailedTCPOwner(t *testing.T) {
	oldTCP, oldUDP := mixedListener, mixedUDPLister
	oldAllow, oldBind := allowLan, bindAddress
	defer func() { mixedListener, mixedUDPLister = oldTCP, oldUDP; allowLan, bindAddress = oldAllow, oldBind }()
	allowLan, bindAddress = false, "127.0.0.1"
	n, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &mixedRecreateCloseFailure{Listener: n}
	f.fail.Store(true)
	l, err := mixed.NewWithConfig(LC.AuthServer{Listen: n.Addr().String()}, mixedRecreateConfig{listener: f}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		f.fail.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := mixed.StopListeners(ctx); err != nil {
			t.Error(err)
		}
	}()
	if err := l.Close(); err == nil {
		t.Fatal("expected retained close failure")
	}
	mixedListener, mixedUDPLister = l, nil
	_, rawPort, _ := net.SplitHostPort(n.Addr().String())
	port, _ := strconv.Atoi(rawPort)
	ReCreateMixed(port, nil)
	if mixedListener != l {
		t.Fatal("mixed recreate discarded failed concrete TCP owner")
	}
	f.fail.Store(false)
	ReCreateMixed(0, nil)
	if mixedListener != nil {
		t.Fatal("mixed recreate failed to retry old TCP cleanup")
	}
}

func TestAngelaNexusMixedRecreateUDPFailurePreservesReusedTCP(t *testing.T) {
	oldTCP, oldUDP := mixedListener, mixedUDPLister
	oldAllow, oldBind := allowLan, bindAddress
	defer func() { mixedListener, mixedUDPLister = oldTCP, oldUDP; allowLan, bindAddress = oldAllow, oldBind }()
	allowLan, bindAddress = false, "127.0.0.1"
	n, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	udp, err := net.ListenPacket("udp", n.Addr().String())
	if err != nil {
		_ = n.Close()
		t.Fatal(err)
	}
	defer udp.Close()
	l, err := mixed.NewWithConfig(LC.AuthServer{Listen: n.Addr().String()}, mixedRecreateConfig{listener: n}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := mixed.StopListeners(ctx); err != nil {
			t.Error(err)
		}
	}()
	mixedListener, mixedUDPLister = l, nil
	_, rawPort, _ := net.SplitHostPort(n.Addr().String())
	port, _ := strconv.Atoi(rawPort)
	ReCreateMixed(port, nil)
	if mixedListener != l || l.IsClosed() {
		t.Fatal("UDP bind failure canceled reused healthy TCP listener")
	}
	peer, err := net.DialTimeout("tcp", n.Addr().String(), time.Second)
	if err != nil {
		t.Fatalf("reused TCP listener no longer accepts: %v", err)
	}
	_ = peer.Close()
}

type mixedUDPRecreateConfig struct {
	C.InboundListenConfig
	pc net.PacketConn
}

func (c mixedUDPRecreateConfig) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	return c.pc, nil
}

type mixedUDPRecreateFailure struct {
	net.PacketConn
	fail atomic.Bool
}

func (p *mixedUDPRecreateFailure) Close() error {
	if p.fail.Load() {
		return errors.New("mixed recreate UDP close refused")
	}
	return p.PacketConn.Close()
}
func TestAngelaNexusMixedRecreateRetainsFailedUDPOwner(t *testing.T) {
	oldTCP, oldUDP := mixedListener, mixedUDPLister
	oldAllow, oldBind := allowLan, bindAddress
	defer func() { mixedListener, mixedUDPLister = oldTCP, oldUDP; allowLan, bindAddress = oldAllow, oldBind }()
	allowLan, bindAddress = false, "127.0.0.1"
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f := &mixedUDPRecreateFailure{PacketConn: pc}
	l, err := socks.NewMixedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, mixedUDPRecreateConfig{pc: f}, nil)
	if err != nil {
		_ = pc.Close()
		t.Fatal(err)
	}
	defer func() {
		f.fail.Store(false)
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := socks.StopMixedUDP(ctx); err != nil {
			t.Error(err)
		}
		if err := mixed.StopListeners(ctx); err != nil {
			t.Error(err)
		}
	}()
	f.fail.Store(true)
	if err := l.Close(); err == nil {
		t.Fatal("expected retained UDP close failure")
	}
	mixedListener, mixedUDPLister = nil, l
	ReCreateMixed(0, nil)
	if mixedUDPLister != l {
		t.Fatal("mixed recreate discarded failed concrete UDP owner")
	}
	f.fail.Store(false)
	ReCreateMixed(0, nil)
	if mixedUDPLister != nil {
		t.Fatal("mixed recreate failed to retry old UDP cleanup")
	}
	_, rawPort, _ := net.SplitHostPort(pc.LocalAddr().String())
	port, _ := strconv.Atoi(rawPort)
	ReCreateMixed(port, nil)
	fresh := mixedUDPLister
	if fresh == nil || fresh == l {
		t.Fatal("mixed recreate did not replace acknowledged UDP generation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := socks.StopMixedUDP(ctx); err != nil {
		t.Fatal(err)
	}
	ReCreateMixed(port, nil)
	if mixedUDPLister == nil || mixedUDPLister == fresh || mixedUDPLister.IsClosed() {
		t.Fatal("mixed recreate reused stopped same-address UDP generation")
	}
}
