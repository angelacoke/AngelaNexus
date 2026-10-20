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

type angelaClosePlan struct {
	calls    atomic.Int32
	failures int32
	err      error
}

func (p *angelaClosePlan) close(realClose func() error) error {
	if p.calls.Add(1) <= p.failures {
		return p.err
	}
	return realClose()
}

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

type angelaTCPConn struct {
	N.ExtendedConn
	closePlan *angelaClosePlan
}

func (c *angelaTCPConn) Close() error {
	if c.closePlan != nil {
		return c.closePlan.close(c.ExtendedConn.Close)
	}
	return c.ExtendedConn.Close()
}

func (c *angelaTCPConn) Chains() C.Chain               { return nil }
func (c *angelaTCPConn) ProviderChains() C.Chain       { return nil }
func (c *angelaTCPConn) AppendToChains(C.ProxyAdapter) {}
func (c *angelaTCPConn) RemoteDestination() string     { return "127.0.0.1" }

type angelaUDPConn struct {
	N.EnhancePacketConn
	closePlan *angelaClosePlan
}

func (c *angelaUDPConn) Close() error {
	if c.closePlan != nil {
		return c.closePlan.close(c.EnhancePacketConn.Close)
	}
	return c.EnhancePacketConn.Close()
}

func (c *angelaUDPConn) Chains() C.Chain                                   { return nil }
func (c *angelaUDPConn) ProviderChains() C.Chain                           { return nil }
func (c *angelaUDPConn) AppendToChains(C.ProxyAdapter)                     {}
func (c *angelaUDPConn) RemoteDestination() string                         { return "127.0.0.1" }
func (c *angelaUDPConn) ResolveUDP(_ context.Context, _ *C.Metadata) error { return nil }

// ResolveUDP's context type is deliberately supplied by the real interface below.
var _ C.Conn = (*angelaTCPConn)(nil)

func angelaRangeHas(t *testing.T, m *Manager, want Tracker) {
	t.Helper()
	var found Tracker
	m.Range(func(c Tracker) bool {
		if c.ID() == want.ID() {
			found = c
		}
		return true
	})
	if found != want {
		t.Fatalf("tracker %q missing from Range", want.ID())
	}
}

func TestAngelaNexusLateConnectionsCloseFailures(t *testing.T) {
	t.Run("registered_tcp_and_udp_retain_until_successful_close", func(t *testing.T) {
		m := &Manager{}
		m.StartRegistrations()

		tcpPeer, tcpRemote := net.Pipe()
		defer tcpPeer.Close()
		defer tcpRemote.Close()
		tcpConn := &angelaTCPConn{
			ExtendedConn: N.NewExtendedConn(tcpPeer),
			closePlan:    &angelaClosePlan{failures: 1, err: errAngelaNexusSentinel},
		}
		tcp, err := NewTCPTrackerAtEpoch(tcpConn, m, &C.Metadata{NetWork: C.TCP}, nil, 0, 0, false, m.RegistrationEpoch())
		if err != nil {
			t.Fatal(err)
		}
		if m.Get(tcp.ID()) != tcp {
			t.Fatal("TCP tracker was not registered")
		}
		if err := tcp.Close(); !errors.Is(err, errAngelaNexusSentinel) {
			t.Fatalf("TCP close error = %v", err)
		}
		if m.Get(tcp.ID()) != tcp {
			t.Fatal("failed TCP close removed tracker")
		}
		angelaRangeHas(t, m, tcp)
		if err := tcp.Close(); err != nil {
			t.Fatal(err)
		}
		if m.Get(tcp.ID()) != nil {
			t.Fatal("successful TCP retry retained tracker")
		}

		rawUDP, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
		if err != nil {
			t.Fatal(err)
		}
		udpConn := &angelaUDPConn{
			EnhancePacketConn: N.NewEnhancePacketConn(rawUDP),
			closePlan:         &angelaClosePlan{failures: 1, err: errAngelaNexusSentinel},
		}
		udp, err := NewUDPTrackerAtEpoch(udpConn, m, &C.Metadata{NetWork: C.UDP}, nil, 0, 0, false, m.RegistrationEpoch())
		if err != nil {
			t.Fatal(err)
		}
		if err := udp.Close(); !errors.Is(err, errAngelaNexusSentinel) {
			t.Fatalf("UDP close error = %v", err)
		}
		if m.Get(udp.ID()) != udp {
			t.Fatal("failed UDP close removed tracker")
		}
		angelaRangeHas(t, m, udp)
		if err := udp.Close(); err != nil {
			t.Fatal(err)
		}
		if m.Get(udp.ID()) != nil {
			t.Fatal("successful UDP retry retained tracker")
		}
	})

	for _, tc := range []struct {
		name string
		err  error
		keep bool
	}{
		{name: "standalone_net_err_closed_is_registration_only", err: net.ErrClosed},
		{name: "mixed_close_error_is_retained", err: errors.Join(net.ErrClosed, errAngelaNexusSentinel), keep: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &Manager{}
			m.StartRegistrations()
			epoch := m.RegistrationEpoch()
			m.StopRegistrations()
			peer, remote := net.Pipe()
			defer peer.Close()
			defer remote.Close()
			conn := &angelaTCPConn{
				ExtendedConn: N.NewExtendedConn(peer),
				closePlan:    &angelaClosePlan{failures: 3, err: tc.err},
			}
			tracker, err := NewTCPTrackerAtEpoch(conn, m, &C.Metadata{NetWork: C.TCP}, nil, 0, 0, false, epoch)
			if tracker != nil {
				t.Fatal("rejected TCP tracker was returned")
			}
			if tc.keep {
				if err == nil || !errors.Is(err, errAngelaNexusSentinel) {
					t.Fatalf("mixed close error was swallowed: %v", err)
				}
				var retained Tracker
				m.Range(func(c Tracker) bool { retained = c; return false })
				if retained == nil {
					t.Fatal("failed JoinAtEpoch close was not retained")
				}
				for retry := 0; retry < 2; retry++ {
					if retryErr := retained.Close(); !errors.Is(retryErr, errAngelaNexusSentinel) {
						t.Fatalf("failed retry %d error = %v", retry, retryErr)
					}
					angelaRangeHas(t, m, retained)
				}
				if retryErr := retained.Close(); retryErr != nil {
					t.Fatal(retryErr)
				}
				if m.Get(retained.ID()) != nil {
					t.Fatal("successful retry did not delete retained tracker")
				}
			} else {
				var retained Tracker
				m.Range(func(c Tracker) bool { retained = c; return false })
				if retained != nil {
					t.Fatal("net.ErrClosed-only rejection was retained")
				}
			}
		})
	}
}

func TestAngelaNexusLateConnectionsRegistrationContextCancellation(t *testing.T) {
	m := &Manager{}
	m.StartRegistrations()
	oldEpoch, oldCtx := m.Registration()
	m.StopRegistrations()
	select {
	case <-oldCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("old registration context was not canceled")
	}
	m.StartRegistrations()
	newEpoch, newCtx := m.Registration()
	if newEpoch == oldEpoch {
		t.Fatal("reopen reused the stopped registration epoch")
	}
	select {
	case <-newCtx.Done():
		t.Fatal("fresh registration context was canceled")
	default:
	}
	stale := &angelaFakeTracker{id: "stale-context"}
	if err := m.JoinAtEpoch(oldEpoch, stale); err == nil || m.Get(stale.id) != nil {
		t.Fatal("stale setup was admitted after stop and reopen")
	}
}

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

func TestAngelaNexusLateConnectionsClosedContextAndConcurrentRestart(t *testing.T) {
	m := &Manager{}
	_, closed := m.Registration()
	if !errors.Is(closed.Err(), context.Canceled) {
		t.Fatal("closed gate supplied live context")
	}
	m.StartRegistrations()
	epoch, first := m.Registration()
	m.StartRegistrations()
	sameEpoch, same := m.Registration()
	if epoch != sameEpoch || first != same {
		t.Fatal("idempotent start replaced live context")
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				m.StopRegistrations()
				m.StartRegistrations()
				_, _ = m.Registration()
			}
		}()
	}
	wg.Wait()
	m.StopRegistrations()
	_, final := m.Registration()
	if final.Err() == nil || first.Err() == nil {
		t.Fatal("stopped generation retains live context")
	}
	m.StartRegistrations()
	_, fresh := m.Registration()
	if fresh.Err() != nil {
		t.Fatal("fresh generation inherited cancellation")
	}
	m.StopRegistrations()
}

func TestAngelaNexusLateConnectionsSetupLedger(t *testing.T) {
	m := &Manager{}
	m.StartRegistrations()
	epoch := m.RegistrationEpoch()
	release, err := m.BeginSetup(epoch)
	if err != nil {
		t.Fatal(err)
	}
	m.StopRegistrations()
	if _, err := m.BeginSetup(epoch); err == nil {
		t.Fatal("closed setup was admitted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := m.WaitSetups(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("WaitSetups error = %v, want timeout", err)
	}
	release()
	release()
	m.StartRegistrations()
	m.StopRegistrations()
	if err := m.WaitSetups(context.Background()); err != nil {
		t.Fatal(err)
	}
	m.StartRegistrations()
	fresh := m.RegistrationEpoch()
	freshRelease, err := m.BeginSetup(fresh)
	if err != nil {
		t.Fatal(err)
	}
	m.StopRegistrations()
	ctx2, cancel2 := context.WithTimeout(context.Background(), 10*time.Millisecond)
	if err := m.WaitSetups(ctx2); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("retained setup WaitSetups error = %v", err)
	}
	cancel2()
	freshRelease()
	if err := m.WaitSetups(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusLateConnectionsSetupDebtSurvivesReopen(t *testing.T) {
	m := &Manager{}
	m.StartRegistrations()
	oldEpoch := m.RegistrationEpoch()
	oldRelease, err := m.BeginSetup(oldEpoch)
	if err != nil {
		t.Fatal(err)
	}
	defer oldRelease()
	if err := m.WaitSetups(context.Background()); err == nil {
		t.Fatal("wait accepted open admission")
	}
	m.StopRegistrations()
	m.StartRegistrations()
	if _, err := m.BeginSetup(oldEpoch); err == nil {
		t.Fatal("stale epoch acquired setup")
	}
	freshRelease, err := m.BeginSetup(m.RegistrationEpoch())
	if err != nil {
		t.Fatal(err)
	}
	defer freshRelease()
	m.StopRegistrations()
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := m.WaitSetups(canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled wait: %v", err)
	}
	oldRelease()
	ctx, timeoutCancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer timeoutCancel()
	if err := m.WaitSetups(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("fresh debt lost after old release: %v", err)
	}
	var releases sync.WaitGroup
	for i := 0; i < 8; i++ {
		releases.Add(1)
		go func() { defer releases.Done(); freshRelease(); oldRelease() }()
	}
	releases.Wait()
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	if err := m.WaitSetups(ctx2); err != nil {
		t.Fatal(err)
	}
	m.StartRegistrations()
	next, err := m.BeginSetup(m.RegistrationEpoch())
	if err != nil {
		t.Fatal(err)
	}
	m.StopRegistrations()
	ctx3, cancel3 := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel3()
	if err := m.WaitSetups(ctx3); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("new drain reused completed channel: %v", err)
	}
	next()
	if err := m.WaitSetups(context.Background()); err != nil {
		t.Fatal(err)
	}
}
