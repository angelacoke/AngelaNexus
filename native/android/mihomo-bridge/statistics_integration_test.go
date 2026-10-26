package statistic

import (
	"testing"
	"time"

	"github.com/metacubex/mihomo/common/atomic"
)

func newStatisticsTestManager() *Manager {
	return &Manager{
		uploadTemp:    atomic.NewInt64(0),
		downloadTemp:  atomic.NewInt64(0),
		uploadBlip:    atomic.NewInt64(0),
		downloadBlip:  atomic.NewInt64(0),
		uploadTotal:   atomic.NewInt64(0),
		downloadTotal: atomic.NewInt64(0),
	}
}

func waitForStatisticsOn(t *testing.T, m *Manager, wantUp, wantDown int64) {
	t.Helper()
	deadline := time.NewTimer(2500 * time.Millisecond)
	defer deadline.Stop()
	for {
		up, down := m.Now()
		if up == wantUp && down == wantDown {
			return
		}
		select {
		case <-deadline.C:
			t.Fatalf("statistics sample = (%d, %d), want (%d, %d)", up, down, wantUp, wantDown)
		case <-time.After(5 * time.Millisecond):
		}
	}
}

func TestAngelaNexusStatisticsWorkerJoinsAndRestartRetainsCounters(t *testing.T) {
	m := newStatisticsTestManager()
	m.StartStatistics()
	m.lifecycleMu.Lock()
	done := m.done
	m.lifecycleMu.Unlock()
	m.StartStatistics()
	m.lifecycleMu.Lock()
	if m.done != done {
		t.Fatal("idempotent StartStatistics replaced the active worker")
	}
	m.lifecycleMu.Unlock()
	m.PushUploaded(7)
	m.PushDownloaded(11)
	waitForStatisticsOn(t, m, 7, 11)

	m.StopStatistics()
	select {
	case <-done:
	default:
		t.Fatal("StopStatistics returned before the worker signaled done")
	}
	if up, down := m.Now(); up != 0 || down != 0 {
		t.Fatalf("StopStatistics left blip counters at (%d, %d)", up, down)
	}
	if up, down := m.Total(); up != 7 || down != 11 {
		t.Fatalf("totals after first stop = (%d, %d), want (7, 11)", up, down)
	}
	m.StopStatistics()

	m.PushUploaded(13)
	m.PushDownloaded(17)
	m.StartStatistics()
	waitForStatisticsOn(t, m, 13, 17)
	m.StopStatistics()
	if up, down := m.Total(); up != 20 || down != 28 {
		t.Fatalf("totals after restart = (%d, %d), want (20, 28)", up, down)
	}
}

func TestAngelaNexusStatisticsConcurrentStartStopIsSerialized(t *testing.T) {
	m := newStatisticsTestManager()
	// Model a worker that has observed its stop signal but has not joined yet.
	m.stop = make(chan struct{})
	m.done = make(chan struct{})
	m.running = true
	stopReturned := make(chan struct{})
	go func() {
		m.StopStatistics()
		close(stopReturned)
	}()
	select {
	case <-m.stop:
	case <-time.After(time.Second):
		t.Fatal("StopStatistics did not signal the worker")
	}
	startReturned := make(chan struct{})
	go func() {
		m.StartStatistics()
		close(startReturned)
	}()
	select {
	case <-startReturned:
		t.Fatal("StartStatistics overlapped a StopStatistics join")
	case <-time.After(20 * time.Millisecond):
	}
	close(m.done)
	select {
	case <-stopReturned:
	case <-time.After(time.Second):
		t.Fatal("StopStatistics did not return after worker join")
	}
	select {
	case <-startReturned:
	case <-time.After(time.Second):
		t.Fatal("queued StartStatistics did not proceed after join")
	}
	m.StopStatistics()
}
