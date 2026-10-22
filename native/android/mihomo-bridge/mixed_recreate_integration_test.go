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
