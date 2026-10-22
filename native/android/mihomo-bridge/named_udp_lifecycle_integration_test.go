package socks

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	LC "github.com/metacubex/mihomo/listener/config"
)

func TestAngelaNexusNamedUDPIsNotInDefaultRegistry(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{})}
	l, err := NewOwnedUDPWithConfig(LC.AuthServer{Listen: pc.LocalAddr().String()}, angelaListenConfig{pc: pc}, tr)
	if err != nil {
		t.Fatal(err)
	}
	udpRegistry.Lock()
	_, registered := udpRegistry.generations[l]
	udpRegistry.Unlock()
	if registered {
		t.Fatal("owned named UDP entered default registry")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.WaitClosed(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusNamedUDPDropReturnsBufferExactlyOnce(t *testing.T) {
	l := &UDPListener{packetConn: fakeAngelaPC{}, mixed: true, pending: 1, readerDone: true, drained: make(chan struct{})}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{})}
	var puts atomic.Int32
	handleMixedSocksUDP(l, tr, angelaWire(t, "retained"), func() { puts.Add(1) }, &net.UDPAddr{})
	p := <-tr.got
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	if err := l.WaitClosed(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("held owned packet not awaited: %v", err)
	}
	cancel()
	if puts.Load() != 0 || string(p.Data()) != "retained" {
		t.Fatal("close prematurely reclaimed packet buffer")
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); p.Drop() }()
	}
	wg.Wait()
	if puts.Load() != 1 {
		t.Fatalf("put calls=%d, want exactly one", puts.Load())
	}
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.WaitClosed(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusNamedUDPMalformedPacketReturned(t *testing.T) {
	l := &UDPListener{packetConn: fakeAngelaPC{}, mixed: true, pending: 1, readerDone: true, drained: make(chan struct{})}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{})}
	var puts atomic.Int32
	handleMixedSocksUDP(l, tr, []byte{0}, func() { puts.Add(1) }, &net.UDPAddr{})
	if puts.Load() != 1 {
		t.Fatalf("malformed put calls=%d", puts.Load())
	}
	select {
	case <-tr.got:
		t.Fatal("malformed packet reached tunnel")
	default:
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.WaitClosed(ctx); err != nil {
		t.Fatal(err)
	}
}

type angelaNamedLateRead struct {
	fakeAngelaPC
	entered chan struct{}
	release chan struct{}
	wire    []byte
	reads   atomic.Int32
	puts    atomic.Int32
}

func (c *angelaNamedLateRead) WaitReadFrom() ([]byte, func(), net.Addr, error) {
	if c.reads.Add(1) > 1 {
		return nil, nil, nil, net.ErrClosed
	}
	close(c.entered)
	<-c.release
	return c.wire, func() { c.puts.Add(1) }, &net.UDPAddr{}, nil
}
func TestAngelaNexusNamedUDPLateReadIsJoinedAndReturned(t *testing.T) {
	pc := &angelaNamedLateRead{entered: make(chan struct{}), release: make(chan struct{}), wire: angelaWire(t, "late")}
	tr := &angelaTunnel{got: make(chan C.UDPPacket, 1), entered: make(chan struct{})}
	l, err := NewOwnedUDPWithConfig(LC.AuthServer{Listen: "127.0.0.1:0"}, angelaListenConfig{pc: pc}, tr)
	if err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	release := func() { once.Do(func() { close(pc.release) }) }
	defer release()
	select {
	case <-pc.entered:
	case <-time.After(time.Second):
		t.Fatal("owned reader not entered")
	}
	if err := l.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	if err := l.WaitClosed(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("late owned reader not awaited: %v", err)
	}
	cancel()
	release()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := l.WaitClosed(ctx); err != nil {
		t.Fatal(err)
	}
	if pc.puts.Load() != 1 {
		t.Fatalf("late put calls=%d", pc.puts.Load())
	}
	select {
	case <-tr.got:
		t.Fatal("late packet admitted after close")
	default:
	}
}
