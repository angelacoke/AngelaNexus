package nat

import (
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
)

type angelaNexusPacketSender struct{ C.PacketSender }

func angelaNexusEntry(t *testing.T, table *Table, lAddr string) *angelaNexusPacketSender {
	t.Helper()
	sender := &angelaNexusPacketSender{}
	if _, loaded := table.GetOrCreate(lAddr, func() C.PacketSender { return sender }); loaded {
		t.Fatal("unexpected pre-existing NAT entry")
	}
	return sender
}

func angelaNexusUDP(t *testing.T) *net.UDPConn {
	t.Helper()
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func angelaNexusClosed(t *testing.T, conn *net.UDPConn) {
	t.Helper()
	if conn == nil {
		return
	}
	if _, err := conn.WriteToUDP([]byte("closed"), conn.LocalAddr().(*net.UDPAddr)); err == nil {
		t.Error("retired UDP socket still accepted a write")
	} else if !errors.Is(err, net.ErrClosed) {
		t.Errorf("closed UDP socket returned %v, want net.ErrClosed", err)
	}
}

func TestAngelaNexusNATLocalAbsentAndReuse(t *testing.T) {
	table := New()
	var absentCalls atomic.Int32
	if conn, err := table.GetOrCreateLocalConn("missing", "remote", func() (*net.UDPConn, error) {
		absentCalls.Add(1)
		return angelaNexusUDP(t), nil
	}); conn != nil || !errors.Is(err, net.ErrClosed) {
		t.Fatalf("missing entry returned conn=%v err=%v, want net.ErrClosed", conn, err)
	}
	if absentCalls.Load() != 0 {
		t.Fatal("maker was called for a missing entry")
	}
	sender := angelaNexusEntry(t, table, "local")
	first, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) { return angelaNexusUDP(t), nil })
	if err != nil {
		t.Fatal(err)
	}
	second, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) { return angelaNexusUDP(t), nil })
	if err != nil || second != first {
		t.Fatalf("socket was not reused: first=%p second=%p err=%v", first, second, err)
	}
	for _, conn := range table.DetachLocalConnsIf("local", sender) {
		_ = conn.Close()
	}
}

func TestAngelaNexusNATLocalSingleFlight(t *testing.T) {
	table := New()
	sender := angelaNexusEntry(t, table, "local")
	started, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	makerConn := angelaNexusUDP(t)
	t.Cleanup(func() { _ = makerConn.Close() })
	var calls atomic.Int32
	const workers = 12
	results, errs := make(chan *net.UDPConn, workers), make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) {
				if calls.Add(1) == 1 {
					close(started)
					<-release
				}
				return makerConn, nil
			})
			results <- conn
			errs <- err
		}()
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("maker did not start")
	}
	close(release)
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("single-flight callers did not finish")
	}
	for i := 0; i < workers; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
		if conn := <-results; conn != makerConn {
			t.Fatal("single-flight callers did not share one socket")
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("maker called %d times", calls.Load())
	}
	for _, conn := range table.DetachLocalConnsIf("local", sender) {
		_ = conn.Close()
	}
}

func TestAngelaNexusNATLocalMakerErrorRetries(t *testing.T) {
	table := New()
	sender := angelaNexusEntry(t, table, "local")
	want := errors.New("maker failed")
	var calls atomic.Int32
	if conn, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) {
		if calls.Add(1) == 1 {
			return nil, want
		}
		return angelaNexusUDP(t), nil
	}); !errors.Is(err, want) || conn != nil {
		t.Fatalf("first maker result conn=%v err=%v", conn, err)
	}
	conn, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) { calls.Add(1); return angelaNexusUDP(t), nil })
	if err != nil || conn == nil || calls.Load() != 2 {
		t.Fatalf("retry failed: conn=%v err=%v calls=%d", conn, err, calls.Load())
	}
	for _, c := range table.DetachLocalConnsIf("local", sender) {
		_ = c.Close()
	}
}

func TestAngelaNexusNATLocalMakerNilAndErrorCloseSocket(t *testing.T) {
	table := New()
	sender := angelaNexusEntry(t, table, "local")
	if conn, err := table.GetOrCreateLocalConn("local", "nil", func() (*net.UDPConn, error) { return nil, nil }); conn != nil || !errors.Is(err, net.ErrClosed) {
		t.Fatalf("nil maker result conn=%v err=%v", conn, err)
	}
	want := errors.New("maker error")
	returned := angelaNexusUDP(t)
	if conn, err := table.GetOrCreateLocalConn("local", "error", func() (*net.UDPConn, error) { return returned, want }); conn != nil || !errors.Is(err, want) {
		t.Fatalf("error maker result conn=%v err=%v", conn, err)
	}
	angelaNexusClosed(t, returned)
	table.DetachLocalConnsIf("local", sender)
}

func TestAngelaNexusNATLocalDetachWakesWaiter(t *testing.T) {
	table := New()
	sender := angelaNexusEntry(t, table, "local")
	item, _ := table.getEntry("local")
	release := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	makerConn := angelaNexusUDP(t)
	t.Cleanup(func() { _ = makerConn.Close() })
	makerResult := make(chan error, 1)
	go func() {
		_, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) { <-release; return makerConn, nil })
		makerResult <- err
	}()
	var pending *localConnCreation
	deadline := time.After(3 * time.Second)
	for pending == nil {
		select {
		case <-deadline:
			t.Fatal("maker did not publish pending creation")
		default:
			item.localMu.Lock()
			pending = item.creating["remote"]
			item.localMu.Unlock()
			if pending == nil {
				time.Sleep(time.Millisecond)
			}
		}
	}
	waiterResult := make(chan error, 1)
	go func() { _, err := item.waitLocalConn(pending); waiterResult <- err }()
	select {
	case err := <-waiterResult:
		t.Fatalf("pending waiter completed before retirement: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	for _, conn := range table.DetachLocalConnsIf("local", sender) {
		_ = conn.Close()
	}
	select {
	case err := <-waiterResult:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("helper error=%v, want net.ErrClosed", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("retirement did not wake helper")
	}
	select {
	case <-makerResult:
		t.Fatal("maker unexpectedly completed before release")
	default:
	}
	close(release)
	select {
	case err := <-makerResult:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("late maker error=%v, want net.ErrClosed", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("maker did not finish after release")
	}
}

func TestAngelaNexusNATLocalLateMakerCannotEnterReplacement(t *testing.T) {
	for _, mode := range []string{"detach", "delete", "delete-if"} {
		t.Run(mode, func(t *testing.T) {
			table := New()
			oldSender := angelaNexusEntry(t, table, "local")
			started, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(release) }) }
			t.Cleanup(unblock)
			oldConn := angelaNexusUDP(t)
			t.Cleanup(func() { _ = oldConn.Close() })
			type outcome struct {
				conn *net.UDPConn
				err  error
			}
			done := make(chan outcome, 1)
			go func() {
				conn, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) {
					close(started)
					<-release
					return oldConn, nil
				})
				done <- outcome{conn, err}
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("old maker did not start")
			}
			switch mode {
			case "detach":
				for _, conn := range table.DetachLocalConnsIf("local", oldSender) {
					_ = conn.Close()
				}
			case "delete":
				table.Delete("local")
			case "delete-if":
				wrongOwner := &angelaNexusPacketSender{}
				if table.DeleteIf("local", wrongOwner) {
					t.Fatal("wrong owner retired the entry")
				}
				if got, ok := table.getEntry("local"); !ok || got.PacketSender != oldSender {
					t.Fatal("wrong-owner deletion changed entry")
				}
				if !table.DeleteIf("local", oldSender) {
					t.Fatal("entry owner failed to delete")
				}
			}
			newSender := angelaNexusEntry(t, table, "local")
			replacement := angelaNexusUDP(t)
			t.Cleanup(func() { _ = replacement.Close() })
			got, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) { return replacement, nil })
			if err != nil || got != replacement {
				t.Fatalf("replacement publication: conn=%v err=%v", got, err)
			}
			var detachers sync.WaitGroup
			for i := 0; i < 8; i++ {
				detachers.Add(1)
				go func() {
					defer detachers.Done()
					table.DetachLocalConnsIf("local", oldSender)
					table.DeleteIf("local", oldSender)
				}()
			}
			detachers.Wait()
			unblock()
			select {
			case result := <-done:
				if result.conn != nil {
					t.Fatal("retired maker returned a socket")
				}
				if !errors.Is(result.err, net.ErrClosed) {
					t.Fatalf("retired maker err=%v", result.err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("retired maker did not finish")
			}
			angelaNexusClosed(t, oldConn)
			if got := table.GetForLocalConn("local", "remote"); got != replacement {
				t.Fatal("late retired maker displaced replacement socket")
			}
			// Check liveness after both late publication and obsolete-owner cleanup.
			if _, err := replacement.WriteToUDP([]byte("replacement"), replacement.LocalAddr().(*net.UDPAddr)); err != nil {
				t.Fatalf("replacement socket write failed: %v", err)
			}
			for _, conn := range table.DetachLocalConnsIf("local", newSender) {
				_ = conn.Close()
			}
			angelaNexusClosed(t, replacement)
		})
	}
}

func TestAngelaNexusNATLocalMakerReentry(t *testing.T) {
	table := New()
	sender := angelaNexusEntry(t, table, "local")
	finished, result := make(chan struct{}), make(chan error, 1)
	otherConn, outerConn := angelaNexusUDP(t), angelaNexusUDP(t)
	t.Cleanup(func() { _ = otherConn.Close(); _ = outerConn.Close() })
	go func() {
		_, err := table.GetOrCreateLocalConn("local", "remote", func() (*net.UDPConn, error) {
			_, err := table.GetOrCreateLocalConn("local", "other", func() (*net.UDPConn, error) { return otherConn, nil })
			if err != nil {
				return nil, err
			}
			detached := table.DetachLocalConnsIf("local", sender)
			for _, conn := range detached {
				_ = conn.Close()
			}
			close(finished)
			return outerConn, nil
		})
		result <- err
	}()
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("maker reentry deadlocked")
	}
	select {
	case err := <-result:
		if !errors.Is(err, net.ErrClosed) {
			t.Fatalf("reentrant retired maker err=%v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("reentrant maker did not finish")
	}
	angelaNexusClosed(t, otherConn)
}
