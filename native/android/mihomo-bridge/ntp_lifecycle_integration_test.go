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
	oldPeer, oldRaw := net.Pipe()
	newPeer, newRaw := net.Pipe()
	oldWrapped := &angelaBlockingCloseConn{Conn: oldRaw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	newWrapped := &angelaBlockingCloseConn{Conn: newRaw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	old, current := angelaNTPService(oldWrapped), angelaNTPService(newWrapped)
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
	angelaNTPWait(t, oldWrapped.closeEntered, "retired cleanup did not enter blocking Close")
	angelaNTPWait(t, newWrapped.closeEntered, "current cleanup did not enter blocking Close")
	close(oldWrapped.closeRelease)
	close(newWrapped.closeRelease)
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
	peer, raw := net.Pipe()
	wrapped := &angelaBlockingCloseConn{Conn: raw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	old := angelaNTPService(wrapped)
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
	angelaNTPWait(t, wrapped.closeEntered, "disabled generation did not enter blocking Close")
	close(wrapped.closeRelease)
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
	closes       atomic.Int32
}

func (c *angelaBlockingCloseConn) Close() error {
	c.once.Do(func() { c.closes.Add(1); close(c.closeEntered) })
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
	if got := wrapped.closes.Load(); got != 1 {
		t.Fatalf("repeated Stop closed the exchange connection %d times", got)
	}
}

// The late-response regression must use a response that the pinned Exchange
// really accepts; otherwise removing its publication fence could pass vacuously.
func TestAngelaNexusNTPValidResponsePositiveControl(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, raw := net.Pipe()
	defer peer.Close()
	conn := &angelaCountConn{Conn: raw}
	srv := angelaNTPService(conn)
	ready := make(chan struct{})
	go angelaNTPReply(peer, 250*time.Millisecond, nil, ready)
	if err := srv.update(); err != nil {
		t.Fatal(err)
	}
	angelaNTPWait(t, ready, "positive response was not served")
	if got := mihomoNtp.GetOffset(); got < 100*time.Millisecond || got > time.Second {
		t.Fatalf("valid positive response did not publish the expected offset: %s", got)
	}
	srv.Stop()
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("successful response left an exchange watcher: %v", err)
	}
	waitCancel()
	if got := conn.closes.Load(); got != 1 {
		t.Fatalf("successful response Close count = %d, want 1", got)
	}
	srv.Stop()
	if got := conn.closes.Load(); got != 1 {
		t.Fatalf("repeated Stop closed successful exchange %d times", got)
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

// ReCreate must be able to admit a live replacement while an older generation
// is still blocked in its raw Close. Releasing and stopping the old generation
// again must not touch the replacement's real UDP socket.
func TestAngelaNexusNTPReloadKeepsReplacementAliveWhileOldCloseBlocks(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	oldPeer, oldRaw := net.Pipe()
	oldWrapped := &angelaBlockingCloseConn{Conn: oldRaw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	old := angelaNTPService(oldWrapped)
	old.Start()
	angelaNTPWait(t, old.dialer.(*angelaNTPDialer).entered, "old generation did not start")
	globalMu.Lock()
	globalSrv = old
	globalMu.Unlock()

	udp, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer udp.Close()
	requests := make(chan struct{}, 4)
	serverDone := make(chan struct{})
	responseRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseResponse := func() { releaseOnce.Do(func() { close(responseRelease) }) }
	defer releaseResponse()
	go func() {
		defer close(serverDone)
		for {
			request := make([]byte, 48)
			n, remote, err := udp.ReadFromUDP(request)
			if err != nil {
				return
			}
			if n < 48 {
				continue
			}
			requests <- struct{}{}
			<-responseRelease
			packet := make([]byte, 48)
			packet[0], packet[1] = 0x24, 1
			copy(packet[24:32], request[40:48])
			ts := timeToNTP(time.Now().Add(180 * time.Millisecond))
			binary.BigEndian.PutUint64(packet[16:24], ts)
			binary.BigEndian.PutUint64(packet[32:40], ts)
			binary.BigEndian.PutUint64(packet[40:48], ts)
			if _, err = udp.WriteToUDP(packet, remote); err != nil {
				return
			}
		}
	}()
	defer func() { releaseResponse(); _ = udp.Close(); <-serverDone }()

	stopDone := make(chan error, 1)
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer stopCancel()
	go func() { stopDone <- StopNTPService(stopCtx) }()
	angelaNTPWait(t, oldWrapped.closeEntered, "concurrent stop did not enter old Close")
	ReCreateNTPService(udp.LocalAddr().String(), 60, "", nil, false)
	globalMu.Lock()
	replacement := globalSrv
	globalMu.Unlock()
	if replacement == nil || replacement == old {
		t.Fatal("real ReCreate did not install a replacement generation")
	}
	angelaNTPWait(t, oldWrapped.closeEntered, "reload did not trigger old raw Close")
	angelaNTPWait(t, requests, "replacement did not enter its UDP exchange")

	old.Stop()
	close(oldWrapped.closeRelease)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := old.WaitClosed(waitCtx); err != nil {
		t.Fatalf("old generation did not drain after release: %v", err)
	}
	waitCancel()
	if err := <-stopDone; err != nil {
		t.Fatalf("old stop snapshot failed: %v", err)
	}
	globalMu.Lock()
	current := globalSrv
	globalMu.Unlock()
	if current != replacement {
		t.Fatal("old stop removed later replacement generation")
	}
	old.Stop()
	releaseResponse()
	// Receiving a request is not a publication barrier. Observe the actual
	// accepted offset while the replacement's first worker completes its exchange.
	deadline := time.NewTimer(time.Second)
	poll := time.NewTicker(time.Millisecond)
	defer deadline.Stop()
	defer poll.Stop()
	for mihomoNtp.GetOffset() < 100*time.Millisecond || mihomoNtp.GetOffset() > time.Second {
		select {
		case <-poll.C:
		case <-deadline.C:
			t.Fatal("replacement did not publish valid offset after old cleanup")
		}
	}
	if err := replacement.update(); err != nil {
		t.Fatalf("replacement update after old release: %v", err)
	}
	angelaNTPWait(t, requests, "replacement exact socket was closed by old cleanup")
	ReCreateNTPService("", 0, "", nil, false)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(ctx); err != nil {
		t.Fatalf("replacement cleanup: %v", err)
	}
	cancel()
	_ = oldPeer.Close()
}

type angelaFailOnceCloseConn struct {
	net.Conn
	closes atomic.Int32
}

func (c *angelaFailOnceCloseConn) Close() error {
	if c.closes.Add(1) == 1 {
		return errors.New("injected raw close failure")
	}
	return c.Conn.Close()
}

// A non-nil raw Close result is debt, not successful cleanup: Stop must report
// it, and only an explicit retry may clear ownership and succeed.
func TestAngelaNexusNTPFailedRawCloseRequiresExplicitRetry(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, raw := net.Pipe()
	conn := &angelaFailOnceCloseConn{Conn: raw}
	d := &angelaNTPDialer{conn: conn, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	srv.Start()
	angelaNTPWait(t, d.entered, "failed-close worker did not start")
	globalMu.Lock()
	globalSrv = srv
	globalMu.Unlock()
	_ = peer.Close()
	stopCtx, stopCancel := context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(stopCtx); err == nil {
		t.Fatal("Stop succeeded despite non-nil raw Close")
	}
	stopCancel()
	globalMu.Lock()
	debt := len(retiredServices)
	globalMu.Unlock()
	if debt == 0 {
		t.Fatal("failed raw Close lost cleanup ownership")
	}
	retryCtx, retryCancel := context.WithTimeout(context.Background(), time.Second)
	if err := StopNTPService(retryCtx); err != nil {
		t.Fatalf("explicit failed-close retry: %v", err)
	}
	retryCancel()
	if got := conn.closes.Load(); got != 2 {
		t.Fatalf("raw Close count after retry = %d, want 2", got)
	}
	globalMu.Lock()
	debt = len(retiredServices)
	globalMu.Unlock()
	if debt != 0 {
		t.Fatalf("successful failed-close retry retained %d owners", debt)
	}
}

// A real connected UDP socket is deliberately left without a response. The
// pinned sing Exchange installs a long read deadline, so this proves Stop
// closes the exact returned connection rather than merely waiting for that
// deadline (or relying on net.Pipe cancellation behavior).
func TestAngelaNexusNTPStopClosesAdmittedLoopbackUDPRead(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	server, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.ParseIP("127.0.0.1"), Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := net.DialUDP("udp", nil, server.LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	d := &angelaNTPDialer{conn: client, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr(server.LocalAddr().String()), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	defer srv.Stop()
	readEntered := make(chan struct{})
	wrapped := &angelaReadEnteredConn{Conn: client, entered: readEntered}
	d.conn = wrapped
	srv.Start()
	angelaNTPWait(t, d.entered, "UDP exchange did not dial")
	angelaNTPWait(t, readEntered, "UDP client did not enter the response read")
	started := time.Now()
	srv.Stop()
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("Stop did not close admitted UDP read: %v", err)
	}
	waitCancel()
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("Stop waited for the Exchange deadline: %s", elapsed)
	}
}

type angelaReadEnteredConn struct {
	net.Conn
	entered chan struct{}
	once    sync.Once
}

func (c *angelaReadEnteredConn) Read(p []byte) (int, error) {
	c.once.Do(func() { close(c.entered) })
	return c.Conn.Read(p)
}

type angelaLateDialer struct {
	conn       net.Conn
	entered    chan struct{}
	release    chan struct{}
	writeCount atomic.Int32
}

func (d *angelaLateDialer) DialContext(context.Context, string, M.Socksaddr) (net.Conn, error) {
	close(d.entered)
	<-d.release // Deliberately ignore context cancellation before returning conn.
	return d.conn, nil
}
func (d *angelaLateDialer) ListenPacket(context.Context, M.Socksaddr) (net.PacketConn, error) {
	return nil, errors.New("not used")
}

type angelaCountConn struct {
	net.Conn
	writes atomic.Int32
	closes atomic.Int32
}

func (c *angelaCountConn) Write(p []byte) (int, error) { c.writes.Add(1); return c.Conn.Write(p) }
func (c *angelaCountConn) Close() error                { c.closes.Add(1); return c.Conn.Close() }

// A dialer may return after its context is canceled. The connection must still
// be registered, closed once, and never reach Exchange's request write.
func TestAngelaNexusNTPLateDialReturnedConnIsClosedWithoutWrite(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, raw := net.Pipe()
	conn := &angelaCountConn{Conn: raw}
	d := &angelaLateDialer{conn: conn, entered: make(chan struct{}), release: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	srv.Start()
	angelaNTPWait(t, d.entered, "late dial did not start")
	srv.Stop()
	close(d.release)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("late dial did not drain: %v", err)
	}
	waitCancel()
	if got := conn.writes.Load(); got != 0 {
		t.Fatalf("late conn was written after cancellation: %d writes", got)
	}
	if got := conn.closes.Load(); got != 1 {
		t.Fatalf("late conn Close count = %d, want 1", got)
	}
	_ = peer.Close()
}

// A valid response arriving after Stop must be accepted by the pinned
// Exchange, while the wrapper's blocking Close keeps cleanup debt visible and
// the lifecycle fence prevents the retired response from publishing offset.
func TestAngelaNexusNTPLateValidResponseCloseDoesNotInterruptRead(t *testing.T) {
	angelaNTPResetGlobals()
	defer angelaNTPResetGlobals()
	peer, raw := net.Pipe()
	wrapped := &angelaBlockingCloseConn{Conn: raw, closeEntered: make(chan struct{}), closeRelease: make(chan struct{})}
	d := &angelaNTPDialer{conn: wrapped, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	srv := &Service{server: M.ParseSocksaddr("127.0.0.1:123"), dialer: d, ticker: time.NewTicker(time.Hour), ctx: ctx, cancel: cancel}
	ready, release := make(chan struct{}), make(chan struct{})
	go angelaNTPReply(peer, 750*time.Millisecond, release, ready)
	mihomoNtp.SetOffset(-333 * time.Millisecond)
	srv.Start()
	angelaNTPWait(t, ready, "late response fixture did not enter read")
	srv.Stop()
	close(release)
	angelaNTPWait(t, wrapped.closeEntered, "late valid exchange did not enter Close")
	short, shortCancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	if err := srv.WaitClosed(short); err == nil {
		t.Fatal("WaitClosed ignored blocking cleanup Close")
	}
	shortCancel()
	if got := mihomoNtp.GetOffset(); got != -333*time.Millisecond {
		t.Fatalf("late valid response crossed offset fence: %s", got)
	}
	close(wrapped.closeRelease)
	waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
	if err := srv.WaitClosed(waitCtx); err != nil {
		t.Fatalf("cleanup retry failed: %v", err)
	}
	waitCancel()
	if got := mihomoNtp.GetOffset(); got != -333*time.Millisecond {
		t.Fatalf("late response published after Close completed: %s", got)
	}
	if got := wrapped.closes.Load(); got != 1 {
		t.Fatalf("late response Close count = %d, want 1", got)
	}
	_ = peer.Close()
}

func TestAngelaNexusNTPExchangeDialerCannotReplaceItsOwnedSocket(t *testing.T) {
	peer, raw := net.Pipe()
	defer peer.Close()
	conn := &angelaCountConn{Conn: raw}
	base := &angelaNTPDialer{conn: conn, entered: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	d := newExchangeDialer(base, ctx)
	first, err := d.DialContext(ctx, "udp", M.ParseSocksaddr("127.0.0.1:123"))
	if err != nil {
		t.Fatal(err)
	}
	if second, err := d.DialContext(ctx, "udp", M.ParseSocksaddr("127.0.0.1:123")); err == nil || second != nil {
		t.Fatal("exchange replaced its captured connection")
	}
	cancel()
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if got := base.calls.Load(); got != 1 {
		t.Fatalf("duplicate underlying dial: %d", got)
	}
	if got := conn.closes.Load(); got != 1 {
		t.Fatalf("captured Close count: %d", got)
	}
}

func TestAngelaNexusNTPClosedOnlyDoesNotHideMixedCleanupFailure(t *testing.T) {
	realFailure := errors.New("unreleased NTP resource")
	for _, tc := range []struct {
		err      error
		released bool
	}{
		{net.ErrClosed, true},
		{errors.Join(net.ErrClosed, net.ErrClosed), true},
		{errors.Join(net.ErrClosed, realFailure), false},
		{realFailure, false},
		{nil, false},
	} {
		if got := ntpClosedOnly(tc.err); got != tc.released {
			t.Fatalf("closed-only(%v)=%v", tc.err, got)
		}
	}
}
