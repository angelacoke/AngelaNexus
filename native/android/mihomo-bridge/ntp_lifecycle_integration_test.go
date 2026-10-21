package ntp

import (
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	mihomoNtp "github.com/metacubex/mihomo/ntp"
	M "github.com/metacubex/sing/common/metadata"
)

type angelaNTPDialer struct {
	conn    net.Conn
	entered chan struct{}
	once    sync.Once
	calls   atomic.Int32
}

func (d *angelaNTPDialer) DialContext(context.Context, string, M.Socksaddr) (net.Conn, error) {
	d.calls.Add(1)
	d.once.Do(func() { close(d.entered) })
	return d.conn, nil
}
func (d *angelaNTPDialer) ListenPacket(context.Context, M.Socksaddr) (net.PacketConn, error) {
	return nil, errors.New("not used")
}

func angelaNTPService(conn net.Conn) *Service {
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: &angelaNTPDialer{conn: conn, entered: make(chan struct{})}, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
}
func angelaNTPResetGlobals() {
	globalMu.Lock()
	globalSrv = nil
	retiredServices = make(map[*Service]struct{})
	globalMu.Unlock()
	mihomoNtp.SetOffset(0)
}
func angelaNTPWait(t *testing.T, ch <-chan struct{}, msg string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal(msg)
	}
}

// angelaNTPReply writes a valid version-4 server response, retaining the
// request's transmit timestamp as OriginTime as required by Exchange.
func angelaNTPReply(conn net.Conn, offset time.Duration, release <-chan struct{}, ready chan<- struct{}) {
	request := make([]byte, 48)
	if _, err := io.ReadFull(conn, request); err != nil {
		return
	}
	close(ready)
	if release != nil {
		<-release
	}
	packet := make([]byte, 48)
	packet[0] = 0x24 // LI=0, VN=4, server mode
	packet[1] = 1    // stratum
	copy(packet[24:32], request[40:48])
	ts := uint64(timeToNTP(time.Now().Add(offset)))
	binary.BigEndian.PutUint64(packet[16:24], ts)
	binary.BigEndian.PutUint64(packet[32:40], ts)
	binary.BigEndian.PutUint64(packet[40:48], ts)
	_, _ = conn.Write(packet)
}
func timeToNTP(t time.Time) uint64 {
	const epochOffset = 2208988800
	sec := uint64(t.Unix() + epochOffset)
	frac := uint64(t.Nanosecond()) << 32 / uint64(time.Second)
	return sec<<32 | frac
}

func TestAngelaNexusNTPStopNTPServiceCancelsCurrentAndRetiredThenJoins(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	oldPeer, oldConn := net.Pipe()
	newPeer, newConn := net.Pipe()
	old, current := angelaNTPService(oldConn), angelaNTPService(newConn)
	old.Start()
	current.Start()
	angelaNTPWait(t, old.dialer.(*angelaNTPDialer).entered, "retired exchange did not start")
	angelaNTPWait(t, current.dialer.(*angelaNTPDialer).entered, "current exchange did not start")
	globalMu.Lock()
	globalSrv = current
	retiredServices[old] = struct{}{}
	globalMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	err := StopNTPService(ctx)
	cancel()
	if err == nil {
		t.Fatal("StopNTPService unexpectedly joined blocked exchanges")
	}
	globalMu.Lock()
	debt := len(retiredServices)
	globalMu.Unlock()
	if debt != 2 {
		t.Fatalf("timed-out stop lost ownership: %d services", debt)
	}
	_ = oldPeer.Close()
	_ = newPeer.Close()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	if err = StopNTPService(ctx); err != nil {
		t.Fatalf("retry stop: %v", err)
	}
	cancel()
	globalMu.Lock()
	debt = len(retiredServices)
	globalMu.Unlock()
	if debt != 0 {
		t.Fatalf("successful retry retained %d services", debt)
	}
}

func TestAngelaNexusNTPReloadDisableUsesRealReCreateAndRetainsOwner(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, conn := net.Pipe()
	old := angelaNTPService(conn)
	old.Start()
	angelaNTPWait(t, old.dialer.(*angelaNTPDialer).entered, "old generation did not start")
	globalMu.Lock()
	globalSrv = old
	globalMu.Unlock()
	// Exercise the production disable path; the test does not hand-write the
	// retired registry entry.
	mihomoNtp.SetOffset(123 * time.Millisecond)
	ReCreateNTPService("", 0, "", nil, false)
	if got := mihomoNtp.GetOffset(); got != 0 {
		t.Fatalf("real disable retained process offset: %s", got)
	}
	globalMu.Lock()
	_, retained := retiredServices[old]
	globalMu.Unlock()
	if !retained {
		t.Fatal("real disable discarded old generation ownership")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := StopNTPService(ctx); err == nil {
		t.Fatal("disable unexpectedly joined blocked old generation")
	}
	cancel()
	_ = peer.Close()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(ctx); err != nil {
		t.Fatalf("old generation cleanup: %v", err)
	}
	cancel()

	// A real reload creates a new local-only generation, then the real disable
	// path retires it and leaves its join ownership visible until Stop succeeds.
	udp, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan struct{})
	go func() {
		defer close(serverDone)
		buffer := make([]byte, 48)
		for {
			_, remote, err := udp.ReadFromUDP(buffer)
			if err != nil {
				return
			}
			// Invalid replies still unblock Exchange; no external server or
			// timing assumption is needed to release an admitted UDP read.
			_, _ = udp.WriteToUDP([]byte{0}, remote)
		}
	}()
	defer func() { _ = udp.Close(); <-serverDone }()
	addr := udp.LocalAddr().String()
	ReCreateNTPService(addr, 60, "", nil, false)
	globalMu.Lock()
	replacement := globalSrv
	globalMu.Unlock()
	if replacement == nil {
		t.Fatal("real reload did not install replacement generation")
	}
	ReCreateNTPService("", 0, "", nil, false)
	globalMu.Lock()
	_, retained = retiredServices[replacement]
	globalMu.Unlock()
	if !retained {
		t.Fatal("real reload/disable lost replacement owner")
	}
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(ctx); err != nil {
		t.Fatalf("replacement cleanup: %v", err)
	}
	cancel()
}

func TestAngelaNexusNTPStartStopConcurrentDoesNotDuplicateWorker(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, conn := net.Pipe()
	srv := angelaNTPService(conn)
	const n = 32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() { defer wg.Done(); srv.Start() }()
	}
	wg.Wait()
	angelaNTPWait(t, srv.dialer.(*angelaNTPDialer).entered, "concurrent Start did not launch worker")
	if got := srv.dialer.(*angelaNTPDialer).calls.Load(); got != 1 {
		t.Fatalf("concurrent Start launched %d exchanges", got)
	}
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() { defer wg.Done(); srv.Stop() }()
	}
	wg.Wait()
	_ = peer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(ctx); err != nil {
		t.Fatalf("concurrent Stop did not join: %v", err)
	}
	cancel()
	if got := srv.dialer.(*angelaNTPDialer).calls.Load(); got != 1 {
		t.Fatalf("Stop/Start race changed worker count to %d", got)
	}
}

func TestAngelaNexusNTPStopCancelsRetriesAndLateValidOffsetCannotPublish(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, conn := net.Pipe()
	d := &angelaNTPDialer{conn: conn, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	ready, release := make(chan struct{}), make(chan struct{})
	go angelaNTPReply(peer, 250*time.Millisecond, release, ready)
	mihomoNtp.SetOffset(77 * time.Millisecond)
	srv.Start()
	angelaNTPWait(t, d.entered, "exchange did not start")
	angelaNTPWait(t, ready, "request did not reach response server")
	srv.Stop()
	close(release)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("late valid exchange did not drain: %v", err)
	}
	waitCancel()
	if got := d.calls.Load(); got != 1 {
		t.Fatalf("retry suppression after exit made %d calls", got)
	}
	if got := mihomoNtp.GetOffset(); got != 77*time.Millisecond {
		t.Fatalf("late retired worker published offset: %s", got)
	}
	_ = peer.Close()
}

func TestAngelaNexusNTPRetiredWorkerCannotClearReplacementOffset(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	oldPeer, oldConn := net.Pipe()
	newPeer, newConn := net.Pipe()
	old, replacement := angelaNTPService(oldConn), angelaNTPService(newConn)
	oldReady, oldRelease := make(chan struct{}), make(chan struct{})
	go angelaNTPReply(oldPeer, 500*time.Millisecond, oldRelease, oldReady)
	old.Start()
	angelaNTPWait(t, old.dialer.(*angelaNTPDialer).entered, "old worker did not start")
	angelaNTPWait(t, oldReady, "old request did not arrive")
	globalMu.Lock()
	globalSrv = replacement
	retiredServices[old] = struct{}{}
	globalMu.Unlock()
	published := -300 * time.Millisecond
	mihomoNtp.SetOffset(published)
	old.Stop()
	close(oldRelease)
	oldCtx, oldCancel := context.WithTimeout(context.Background(), time.Second)
	if err := old.WaitClosed(oldCtx); err != nil {
		t.Fatalf("retired generation did not drain: %v", err)
	}
	oldCancel()
	if got := mihomoNtp.GetOffset(); got != published {
		t.Fatalf("retired worker cleared replacement offset: got %s want %s", got, published)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(ctx); err != nil {
		t.Fatalf("generation cleanup: %v", err)
	}
	cancel()
	_ = oldPeer.Close()
	_ = newPeer.Close()
	_ = newConn.Close()
}

type angelaBlockingCloseConn struct {
	net.Conn
	closeEntered chan struct{}
	closeRelease chan struct{}
	once         sync.Once
}

func (c *angelaBlockingCloseConn) Close() error {
	c.once.Do(func() { close(c.closeEntered) })
	<-c.closeRelease
	return c.Conn.Close()
}

func TestAngelaNexusNTPWaitClosedIncludesExchangeDeferredClose(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, raw := net.Pipe()
	wrapped := &angelaBlockingCloseConn{Conn: raw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	d := &angelaNTPDialer{conn: wrapped, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	srv.Start()
	angelaNTPWait(t, d.entered, "exchange did not start")
	srv.Stop()
	_ = peer.Close()
	angelaNTPWait(t, wrapped.closeEntered, "Exchange did not enter deferred Close")
	short, shortCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := srv.WaitClosed(short); err == nil {
		t.Fatal("WaitClosed returned before wrapped Close returned")
	}
	shortCancel()
	close(wrapped.closeRelease)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("WaitClosed after Close release: %v", err)
	}
	waitCancel()
	srv.Stop()
	if got := d.calls.Load(); got != 1 {
		t.Fatalf("repeated Stop altered worker count to %d", got)
	}
}

// The late-response regression must use a response that the pinned Exchange
// really accepts; otherwise removing its publication fence could pass vacuously.
func TestAngelaNexusNTPValidResponsePositiveControl(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, conn := net.Pipe()
	defer peer.Close()
	defer conn.Close()
	srv := angelaNTPService(conn)
	defer srv.Stop()
	ready := make(chan struct{})
	go angelaNTPReply(peer, 250*time.Millisecond, nil, ready)
	if err := srv.update(); err != nil {
		t.Fatal(err)
	}
	angelaNTPWait(t, ready, "positive response was not served")
	if got := mihomoNtp.GetOffset(); got < 100*time.Millisecond || got > time.Second {
		t.Fatalf("valid positive response did not publish the expected offset: %s", got)
	}
}

func TestAngelaNexusNTPStopBeforeStartIsTerminal(t *testing.T) {
	srv := angelaNTPService(nil)
	srv.Stop()
	srv.Start()
	srv.Start()
	if srv.done != nil || srv.dialer.(*angelaNTPDialer).calls.Load() != 0 {
		t.Fatal("stopped service started a worker")
	}
	if err := srv.WaitClosed(context.Background()); err != nil {
		t.Fatal(err)
	}
}
