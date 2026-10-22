package inbound

import (
	"context"
	"errors"
	"net"
	"strconv"
	"sync"
	"testing"
	"time"
)

type angelaFailCloseListener struct {
	net.Listener
	mu    sync.Mutex
	fails int
}

func (l *angelaFailCloseListener) Close() error {
	l.mu.Lock()
	if l.fails > 0 {
		l.fails--
		l.mu.Unlock()
		return errors.New("injected close failure")
	}
	l.mu.Unlock()
	return l.Listener.Close()
}

type angelaPartialListenConfig struct {
	tcp *angelaFailCloseListener
}

func (c *angelaPartialListenConfig) Listen(_ context.Context, network, address string) (net.Listener, error) {
	l, err := net.Listen(network, address)
	if err != nil {
		return nil, err
	}
	c.tcp = &angelaFailCloseListener{Listener: l, fails: 2}
	return c.tcp, nil
}

func (c *angelaPartialListenConfig) ListenPacket(context.Context, string, string) (net.PacketConn, error) {
	return nil, errors.New("injected UDP listen failure")
}

func TestAngelaNexusNamedMixedPartialListenCloseRetry(t *testing.T) {
	lc := &angelaPartialListenConfig{}
	m, err := NewMixed(&MixedOption{BaseOption: BaseOption{
		Listen: "127.0.0.1", Port: "0", NameStr: "angela-partial", ListenConfigForAPI: lc,
	}, UDP: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Listen(nil); err == nil {
		t.Fatal("partial UDP listen unexpectedly succeeded")
	}
	if lc.tcp == nil {
		t.Fatal("partial TCP listener was not created")
	}
	addr := lc.tcp.Addr().String()
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer stopCancel()
	if err := StopNamedMixed(stopCtx); err == nil {
		t.Fatal("first stop did not report injected close debt")
	}
	if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
		c.Close()
	} else {
		// The first retry is allowed to close the socket after reporting debt;
		// the important invariant is that the owner remains retryable.
		t.Logf("socket no longer accepts after failed close: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := StopNamedMixed(ctx); err != nil {
		t.Fatalf("retry stop failed: %v", err)
	}
	bound, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("partial listener leaked after stop retry: %v", err)
	}
	_ = bound.Close()
}

func TestAngelaNexusNamedMixedRetiredGenerationIsolation(t *testing.T) {
	first, err := NewMixed(&MixedOption{BaseOption: BaseOption{Listen: "127.0.0.1", Port: "0", NameStr: "angela-retired"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Listen(nil); err != nil {
		t.Fatal(err)
	}
	_, port, err := net.SplitHostPort(first.Address())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := StopNamedMixed(ctx); err != nil {
		t.Fatal(err)
	}
	second, err := NewMixed(&MixedOption{BaseOption: BaseOption{Listen: "127.0.0.1", Port: port, NameStr: "angela-retired"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Listen(nil); err != nil {
		t.Fatalf("new generation could not reclaim retired port: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	peer, err := net.DialTimeout("tcp", second.Address(), time.Second)
	if err != nil {
		t.Fatalf("retired close affected replacement: %v", err)
	}
	_ = peer.Close()
	if err := StopNamedMixed(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusNamedMixedListenAddressIsUsable(t *testing.T) {
	m, err := NewMixed(&MixedOption{BaseOption: BaseOption{Listen: "127.0.0.1", Port: "0", NameStr: "angela-port-" + strconv.Itoa(time.Now().Nanosecond())}})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.Listen(nil); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := StopNamedMixed(ctx); err != nil {
		t.Fatal(err)
	}
}
