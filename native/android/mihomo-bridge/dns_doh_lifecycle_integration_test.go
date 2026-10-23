package dns

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	stdhttp "net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metacubex/http"
	"github.com/metacubex/quic-go/http3"
	D "github.com/miekg/dns"
)

// Exercise the same io.Closer path as HTTP/3, with controllable failures and
// completion. No public DNS, time-based network failure or GC timing is needed.
type angelaDoHTransport struct {
	calls    atomic.Int32
	fail     atomic.Bool
	entered  chan struct{}
	release  <-chan struct{}
	once     sync.Once
	exchange func(*http.Request) (*http.Response, error)
}

var errAngelaDoHClose = errors.New("injected DoH transport close failure")

func (tr *angelaDoHTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if tr.exchange != nil {
		return tr.exchange(req)
	}
	return nil, errors.New("unexpected network request")
}
func (tr *angelaDoHTransport) Close() error {
	tr.calls.Add(1)
	if tr.entered != nil {
		tr.once.Do(func() { close(tr.entered) })
	}
	if tr.release != nil {
		<-tr.release
	}
	if tr.fail.Load() {
		return errors.Join(net.ErrClosed, errAngelaDoHClose)
	}
	return nil
}

func angelaDoHWithTransport(tr *angelaDoHTransport) (*dnsOverHTTPS, *http.Client) {
	client := &http.Client{Transport: tr}
	u, _ := url.Parse("http://127.0.0.1/dns-query")
	return &dnsOverHTTPS{client: client, url: u}, client
}

func TestAngelaNexusDoHResetRetainsFailedOwner(t *testing.T) {
	tr := &angelaDoHTransport{}
	tr.fail.Store(true)
	doh, client := angelaDoHWithTransport(tr)
	doh.ResetConnection()
	if doh.client != nil || len(doh.retired) != 1 {
		t.Fatal("reset lost failed DoH transport ownership")
	}
	if _, ok := doh.retired[client]; !ok {
		t.Fatal("wrong retired DoH client")
	}
	if got, _, err := doh.getClient(context.Background()); got != nil || !errors.Is(err, errAngelaDoHClose) {
		t.Fatalf("acquisition bypassed pending DoH cleanup: client=%p err=%v", got, err)
	}
	if len(doh.retired) != 1 {
		t.Fatal("acquisition forgot failed owner")
	}
	tr.fail.Store(false)
	doh.ResetConnection()
	if len(doh.retired) != 0 || tr.calls.Load() != 3 {
		t.Fatalf("reset did not retry exactly once per pass: pending=%d calls=%d", len(doh.retired), tr.calls.Load())
	}
	// Reset is reusable; an empty HTTP transport can be lazily published again.
	got, cached, err := doh.getClient(context.Background())
	if err != nil || got == nil || got == client || cached {
		t.Fatalf("reset was terminal: %p %v %v", got, cached, err)
	}
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestAngelaNexusDoHRetryResetRetainsFailedOwner(t *testing.T) {
	tr := &angelaDoHTransport{}
	tr.fail.Store(true)
	doh, _ := angelaDoHWithTransport(tr)
	got, err := doh.resetClient(context.Background(), errors.New("retry trigger"))
	if got != nil || !errors.Is(err, errAngelaDoHClose) || len(doh.retired) != 1 {
		t.Fatalf("retry reset lost failed DoH owner: client=%p pending=%d err=%v", got, len(doh.retired), err)
	}
	tr.fail.Store(false)
	if err := doh.Close(); err != nil || tr.calls.Load() != 2 {
		t.Fatalf("Close failed to retry retirement: %v calls=%d", err, tr.calls.Load())
	}
}

func TestAngelaNexusDoHCloseTerminalAndRetryable(t *testing.T) {
	tr := &angelaDoHTransport{}
	tr.fail.Store(true)
	doh, _ := angelaDoHWithTransport(tr)
	if err := doh.Close(); !errors.Is(err, errAngelaDoHClose) {
		t.Fatalf("Close hid mixed failure: %v", err)
	}
	if !doh.closed || doh.client != nil || len(doh.retired) != 1 {
		t.Fatal("Close lost terminal pending owner")
	}
	if got, _, err := doh.getClient(context.Background()); got != nil || !errors.Is(err, net.ErrClosed) {
		t.Fatalf("closed DoH reopened: %p %v", got, err)
	}
	if got, err := doh.resetClient(context.Background(), context.DeadlineExceeded); got != nil || !errors.Is(err, net.ErrClosed) {
		t.Fatalf("retry reopened closed DoH: %p %v", got, err)
	}
	query := new(D.Msg)
	query.SetQuestion("closed.angelanexus.test.", D.TypeA)
	if _, err := doh.ExchangeContext(context.Background(), query); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("closed ExchangeContext: %v", err)
	}
	tr.fail.Store(false)
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
	doh.ResetConnection()
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
	if len(doh.retired) != 0 || tr.calls.Load() != 2 {
		t.Fatalf("idempotent close repeated successful resource: pending=%d calls=%d", len(doh.retired), tr.calls.Load())
	}
	if _, _, err := doh.getClient(context.Background()); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("reset cleared terminal state: %v", err)
	}
}

func TestAngelaNexusDoHCloseAttemptsEveryOwner(t *testing.T) {
	failed, good := &angelaDoHTransport{}, &angelaDoHTransport{}
	failed.fail.Store(true)
	doh, active := angelaDoHWithTransport(failed)
	other := &http.Client{Transport: good}
	// Include an alias of the published client: attempt only once in this pass.
	doh.retired = map[*http.Client]struct{}{active: {}, other: {}}
	if err := doh.Close(); !errors.Is(err, errAngelaDoHClose) {
		t.Fatal(err)
	}
	if failed.calls.Load() != 1 || good.calls.Load() != 1 || len(doh.retired) != 1 {
		t.Fatal("Close skipped owner, duplicated alias or discarded failed owner")
	}
	failed.fail.Store(false)
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
	if failed.calls.Load() != 2 || good.calls.Load() != 1 || len(doh.retired) != 0 {
		t.Fatal("retry closed the wrong generation")
	}
}

func TestAngelaNexusDoHConcurrentCloseResetAndAcquire(t *testing.T) {
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	tr := &angelaDoHTransport{entered: make(chan struct{}), release: release}
	doh, _ := angelaDoHWithTransport(tr)
	closing := make(chan error, 1)
	go func() { closing <- doh.Close() }()
	select {
	case <-tr.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("close never reached transport")
	}
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := 0; i < 8; i++ {
		wg.Add(3)
		go func() { defer wg.Done(); doh.ResetConnection() }()
		go func() {
			defer wg.Done()
			c, _, err := doh.getClient(context.Background())
			if c != nil || !errors.Is(err, net.ErrClosed) {
				errs <- fmt.Errorf("late getClient reopened client: %p %v", c, err)
			}
		}()
		go func() {
			defer wg.Done()
			c, err := doh.resetClient(context.Background(), context.DeadlineExceeded)
			if c != nil || !errors.Is(err, net.ErrClosed) {
				errs <- fmt.Errorf("late resetClient reopened client: %p %v", c, err)
			}
		}()
	}
	select {
	case err := <-closing:
		t.Fatalf("Close completed before transport: %v", err)
	default:
	}
	unblock()
	select {
	case err := <-closing:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Close failed to finish")
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("concurrent lifecycle calls failed to finish")
	}
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if tr.calls.Load() != 1 || len(doh.retired) != 0 {
		t.Fatal("concurrent lifecycle duplicated or forgot retirement")
	}
}

func TestAngelaNexusDoHClosedErrorClassification(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		ok   bool
	}{
		{"nil", nil, true},
		{"closed", net.ErrClosed, true},
		{"wrapped", fmt.Errorf("wrap: %w", net.ErrClosed), true},
		{"joined closed", errors.Join(net.ErrClosed, fmt.Errorf("wrap: %w", net.ErrClosed)), true},
		{"real failure", errAngelaDoHClose, false},
		{"mixed", errors.Join(net.ErrClosed, errAngelaDoHClose), false},
		{"wrapped mixed", fmt.Errorf("wrap: %w", errors.Join(net.ErrClosed, errAngelaDoHClose)), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := dohClosedOnly(tc.err); got != tc.ok {
				t.Fatalf("closed-only=%v want %v", got, tc.ok)
			}
		})
	}
}

func TestAngelaNexusDoHRealHTTP3TransportClose(t *testing.T) {
	transport := &http3Transport{baseTransport: &http3.Transport{}}
	doh := &dnsOverHTTPS{client: &http.Client{Transport: transport}}
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
	if !transport.closed || doh.client != nil || len(doh.retired) != 0 {
		t.Fatal("real HTTP3 transport not retired")
	}
	req, err := http.NewRequest(http.MethodGet, "https://127.0.0.1/dns-query", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := transport.RoundTrip(req); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("retired HTTP3 transport admitted request: %v", err)
	}
}

// This is an actual loopback HTTP DoH connection, not only a mock closer. The
// reset must close its idle socket, remain reusable, and explicit Close must
// reject subsequent requests without creating a third connection.
func TestAngelaNexusDoHLoopbackResetAndClose(t *testing.T) {
	var connections atomic.Int32
	closed := make(chan struct{}, 4)
	server := httptest.NewUnstartedServer(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		payload, err := base64.RawURLEncoding.DecodeString(r.URL.Query().Get("dns"))
		if err != nil {
			t.Errorf("DoH payload: %v", err)
			w.WriteHeader(400)
			return
		}
		query := new(D.Msg)
		if err := query.Unpack(payload); err != nil {
			t.Errorf("DoH query: %v", err)
			w.WriteHeader(400)
			return
		}
		reply := new(D.Msg)
		reply.SetReply(query)
		body, err := reply.Pack()
		if err != nil {
			t.Errorf("DoH reply: %v", err)
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/dns-message")
		_, _ = w.Write(body)
	}))
	server.Config.ConnState = func(_ net.Conn, state stdhttp.ConnState) {
		if state == stdhttp.StateNew {
			connections.Add(1)
		}
		if state == stdhttp.StateClosed {
			closed <- struct{}{}
		}
	}
	server.Start()
	defer server.Close()
	doh := newDoHClient(server.URL+"/dns-query", nil, false, nil, nil, "").(*dnsOverHTTPS)
	defer doh.Close()
	query := new(D.Msg)
	query.SetQuestion("owner.angelanexus.test.", D.TypeTXT)
	exchange := func() {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := doh.ExchangeContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	waitClosed := func() {
		t.Helper()
		select {
		case <-closed:
		case <-time.After(3 * time.Second):
			t.Fatal("DoH did not close real idle socket")
		}
	}
	exchange()
	doh.ResetConnection()
	waitClosed()
	exchange()
	if connections.Load() != 2 {
		t.Fatalf("reset did not reconnect once: %d", connections.Load())
	}
	if err := doh.Close(); err != nil {
		t.Fatal(err)
	}
	waitClosed()
	if _, err := doh.ExchangeContext(context.Background(), query); !errors.Is(err, net.ErrClosed) {
		t.Fatalf("closed real DoH reopened: %v", err)
	}
	if connections.Load() != 2 {
		t.Fatal("closed real DoH created a new socket")
	}
}

// A request that already acquired the client is outside the publication seal.
// Close may return before it does. Its late error must still not reset/reopen
// a closed owner; a late success is deliberately permitted, not a drain claim.
func TestAngelaNexusDoHAlreadyAcquiredRequestBoundary(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprintf("late-error=%v", fail), func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			lateError := errors.New("late DoH request failure")
			tr := &angelaDoHTransport{exchange: func(req *http.Request) (*http.Response, error) {
				close(entered)
				<-release
				if fail {
					return nil, lateError
				}
				payload, err := base64.RawURLEncoding.DecodeString(req.URL.Query().Get("dns"))
				if err != nil {
					return nil, err
				}
				query := new(D.Msg)
				if err := query.Unpack(payload); err != nil {
					return nil, err
				}
				reply := new(D.Msg)
				reply.SetReply(query)
				body, err := reply.Pack()
				if err != nil {
					return nil, err
				}
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header), Request: req}, nil
			}}
			doh, _ := angelaDoHWithTransport(tr)
			defer doh.Close()
			query := new(D.Msg)
			query.SetQuestion("active.angelanexus.test.", D.TypeTXT)
			done := make(chan error, 1)
			go func() { _, err := doh.ExchangeContext(context.Background(), query); done <- err }()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("request did not acquire client")
			}
			if err := doh.Close(); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				t.Fatalf("blocked active request unexpectedly completed: %v", err)
			default:
			}
			if got, _, err := doh.getClient(context.Background()); got != nil || !errors.Is(err, net.ErrClosed) {
				t.Fatalf("publication seal lost with active request: %p %v", got, err)
			}
			unblock()
			select {
			case err := <-done:
				if fail && !errors.Is(err, lateError) {
					t.Fatalf("late error lost: %v", err)
				}
				if !fail && err != nil {
					t.Fatalf("admitted request may complete: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("released request failed to finish")
			}
			if tr.calls.Load() != 1 || doh.client != nil || len(doh.retired) != 0 {
				t.Fatal("late request reset or republished closed client")
			}
		})
	}
}
