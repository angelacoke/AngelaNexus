package statistic

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	N "github.com/metacubex/mihomo/common/net"
	C "github.com/metacubex/mihomo/constant"
)

var errAngelaNexusSentinel = errors.New("angela-nexus-close-sentinel")

type angelaFakeTracker struct {
	id    string
	idFn  func() string
	close func() error
	info  *TrackerInfo
}

func (f *angelaFakeTracker) ID() string {
	if f.idFn != nil {
		return f.idFn()
	}
	return f.id
}
func (f *angelaFakeTracker) Close() error {
	if f.close != nil {
		return f.close()
	}
	return nil
}
func (f *angelaFakeTracker) Info() *TrackerInfo            { return f.info }
func (f *angelaFakeTracker) Chains() C.Chain               { return nil }
func (f *angelaFakeTracker) ProviderChains() C.Chain       { return nil }
func (f *angelaFakeTracker) AppendToChains(C.ProxyAdapter) {}
func (f *angelaFakeTracker) RemoteDestination() string     { return "loopback" }

type angelaTCPConn struct{ N.ExtendedConn }

func (c *angelaTCPConn) Chains() C.Chain               { return nil }
func (c *angelaTCPConn) ProviderChains() C.Chain       { return nil }
func (c *angelaTCPConn) AppendToChains(C.ProxyAdapter) {}
func (c *angelaTCPConn) RemoteDestination() string     { return "127.0.0.1" }

type angelaUDPConn struct{ N.EnhancePacketConn }

func (c *angelaUDPConn) Chains() C.Chain                                   { return nil }
func (c *angelaUDPConn) ProviderChains() C.Chain                           { return nil }
func (c *angelaUDPConn) AppendToChains(C.ProxyAdapter)                     {}
func (c *angelaUDPConn) RemoteDestination() string                         { return "127.0.0.1" }
func (c *angelaUDPConn) ResolveUDP(_ context.Context, _ *C.Metadata) error { return nil }

// ResolveUDP's context type is deliberately supplied by the real interface below.
var _ C.Conn = (*angelaTCPConn)(nil)

func TestAngelaNexusLateConnections(t *testing.T) {
	t.Run("closed_gate_closes_real_tcp_and_udp_and_preserves_legacy_constructor", func(t *testing.T) {
		m := &Manager{}
		m.StartRegistrations()
		m.StopRegistrations()
		epoch := m.RegistrationEpoch()

		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer ln.Close()
		accepted := make(chan net.Conn, 1)
		go func() {
			c, e := ln.Accept()
			if e == nil {
				accepted <- c
			}
		}()
		client, err := net.Dial("tcp", ln.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		rawTCP := <-accepted
		tcp, err := NewTCPTrackerAtEpoch(&angelaTCPConn{ExtendedConn: N.NewExtendedConn(rawTCP)}, m, &C.Metadata{}, nil, 0, 0, false, epoch)
		if err == nil || tcp != nil {
			t.Fatal("closed epoch admitted TCP tracker")
		}
		_ = client.Close()
		if _, err = rawTCP.Write([]byte("x")); err == nil {
			t.Fatal("rejected TCP underlying socket remained open")
		}

		rawUDP, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			t.Fatal(err)
		}
		udp, err := NewUDPTrackerAtEpoch(&angelaUDPConn{EnhancePacketConn: N.NewEnhancePacketConn(rawUDP)}, m, &C.Metadata{}, nil, 0, 0, false, epoch)
		if err == nil || udp != nil {
			t.Fatal("closed epoch admitted UDP tracker")
		}
		if _, _, err = rawUDP.ReadFromUDP(make([]byte, 1)); err == nil {
			t.Fatal("rejected UDP underlying socket remained open")
		}

		// The original constructor remains source-compatible and still registers.
		m.StartRegistrations()
		legacyRaw, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			t.Fatal(err)
		}
		legacy := NewUDPTracker(&angelaUDPConn{EnhancePacketConn: N.NewEnhancePacketConn(legacyRaw)}, m, &C.Metadata{}, nil, 0, 0, false)
		if legacy == nil || m.Get(legacy.ID()) == nil {
			t.Fatal("legacy NewUDPTracker did not register")
		}
		_ = legacy.Close()
	})

	t.Run("stop_restart_epoch", func(t *testing.T) {
		m := &Manager{}
		m.StartRegistrations()
		old := m.RegistrationEpoch()
		m.StopRegistrations()
		m.StartRegistrations()
		fresh := m.RegistrationEpoch()
		if fresh == old {
			t.Fatal("restart did not create a new epoch")
		}
		stale := &angelaFakeTracker{id: "stale"}
		if err := m.JoinAtEpoch(old, stale); err == nil || m.Get(stale.id) != nil {
			t.Fatal("stale epoch admitted")
		}
		current := &angelaFakeTracker{id: "current"}
		if err := m.JoinAtEpoch(fresh, current); err != nil {
			t.Fatal(err)
		}
		if m.Get(current.id) != current {
			t.Fatal("current epoch tracker missing")
		}
	})

	t.Run("join_stop_race_all_successes_are_observable", func(t *testing.T) {
		m := &Manager{}
		m.StartRegistrations()
		epoch := m.RegistrationEpoch()
		const n = 128
		var wg sync.WaitGroup
		var mu sync.Mutex
		admitted := map[string]bool{}
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				id := fmt.Sprintf("race-%d", i)
				tr := &angelaFakeTracker{id: id}
				if m.JoinAtEpoch(epoch, tr) == nil {
					mu.Lock()
					admitted[id] = true
					mu.Unlock()
				}
			}(i)
		}
		go func() { time.Sleep(time.Microsecond); m.StopRegistrations() }()
		wg.Wait()
		seen := map[string]bool{}
		m.Range(func(c Tracker) bool { seen[c.ID()] = true; return true })
		for id := range admitted {
			if !seen[id] {
				t.Fatalf("successful admission %q absent from Range", id)
			}
		}
	})

	t.Run("reentrant_id_and_close_errors_are_not_deadlocked_or_swallowed", func(t *testing.T) {
		m := &Manager{}
		m.StartRegistrations()
		epoch := m.RegistrationEpoch()
		var calls atomic.Int32
		reentrant := &angelaFakeTracker{id: "reentrant", close: func() error { return nil }}
		reentrant.idFn = func() string {
			calls.Add(1)
			_ = m.RegistrationEpoch()
			_ = m.Get("none")
			m.Range(func(Tracker) bool { return false })
			return "reentrant"
		}
		if err := m.JoinAtEpoch(epoch, reentrant); err != nil {
			t.Fatal(err)
		}
		if calls.Load() == 0 {
			t.Fatal("ID callback was not called")
		}

		m.StopRegistrations()
		mixed := &angelaFakeTracker{id: "mixed", close: func() error { return errors.Join(net.ErrClosed, errAngelaNexusSentinel) }}
		err := m.JoinAtEpoch(epoch, mixed)
		if err == nil || !errors.Is(err, errAngelaNexusSentinel) {
			t.Fatalf("mixed close error swallowed: %v", err)
		}
		if m.Get(mixed.id) != mixed {
			t.Fatal("failed-close tracker was not retained")
		}
		mixed.close = func() error { m.Leave(mixed); return nil }
		if err := mixed.Close(); err != nil {
			t.Fatal(err)
		}
		if m.Get(mixed.id) != nil {
			t.Fatal("successful retry did not remove retained tracker")
		}
	})
}
