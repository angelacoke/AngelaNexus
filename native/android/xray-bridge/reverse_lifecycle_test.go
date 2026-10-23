package inbound

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/xtls/xray-core/app/proxyman"
	manageroutbound "github.com/xtls/xray-core/app/proxyman/outbound"
	"github.com/xtls/xray-core/common/protocol"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/common/uuid"
	"github.com/xtls/xray-core/features"
	"github.com/xtls/xray-core/features/outbound"
	vless "github.com/xtls/xray-core/proxy/vless"
	"github.com/xtls/xray-core/transport"
)

// fakeOutboundManager embeds the feature interface and overrides only the
// methods exercised by reverse admission/removal. Its mutex also makes the
// assertions useful under -race.
type fakeOutboundManager struct {
	outbound.Manager
	mu          sync.Mutex
	handlers    map[string]outbound.Handler
	addCalls    int
	removeCalls int
	failAdd     atomic.Bool
	failRemove  atomic.Bool
}

func newFakeOutboundManager(withDefault bool) *fakeOutboundManager {
	m := &fakeOutboundManager{handlers: make(map[string]outbound.Handler)}
	if withDefault {
		m.handlers["default"] = &fakeOutboundHandler{tag: "default"}
	}
	return m
}
func (*fakeOutboundManager) Type() interface{} { return (*fakeOutboundManager)(nil) }
func (*fakeOutboundManager) Start() error      { return nil }
func (*fakeOutboundManager) Close() error      { return nil }
func (m *fakeOutboundManager) GetHandler(tag string) outbound.Handler {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.handlers[tag]
}
func (m *fakeOutboundManager) GetDefaultHandler() outbound.Handler {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, h := range m.handlers {
		if h.Tag() == "default" {
			return h
		}
	}
	return nil
}
func (m *fakeOutboundManager) ListHandlers(context.Context) []outbound.Handler {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]outbound.Handler, 0, len(m.handlers))
	for _, h := range m.handlers {
		out = append(out, h)
	}
	return out
}
func (m *fakeOutboundManager) AddHandler(_ context.Context, h outbound.Handler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.addCalls++
	if m.failAdd.Load() {
		return errors.New("injected add failure")
	}
	m.handlers[h.Tag()] = h
	return nil
}
func (m *fakeOutboundManager) RemoveHandler(_ context.Context, tag string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.removeCalls++
	if m.failRemove.Load() {
		return errors.New("injected remove failure")
	}
	delete(m.handlers, tag)
	return nil
}

func (m *fakeOutboundManager) RemoveHandlerIf(_ context.Context, tag string, owner outbound.Handler) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.removeCalls++
	if m.failRemove.Load() {
		return errors.New("injected remove failure")
	}
	if m.handlers[tag] == owner {
		delete(m.handlers, tag)
	}
	return nil
}

// fakeOutboundHandler is only the default outbound; reverse handlers are the
// real Reverse values produced by GetReverse.
type fakeOutboundHandler struct{ tag string }

func (h *fakeOutboundHandler) Type() interface{}                       { return (*fakeOutboundHandler)(nil) }
func (h *fakeOutboundHandler) Start() error                            { return nil }
func (h *fakeOutboundHandler) Close() error                            { return nil }
func (h *fakeOutboundHandler) Tag() string                             { return h.tag }
func (*fakeOutboundHandler) Dispatch(context.Context, *transport.Link) {}
func (*fakeOutboundHandler) SenderSettings() *serial.TypedMessage      { return nil }
func (*fakeOutboundHandler) ProxySettings() *serial.TypedMessage       { return nil }

var _ features.Feature = (*fakeOutboundManager)(nil)
var _ outbound.Handler = (*fakeOutboundHandler)(nil)

func reverseTestHandler(m outbound.Manager, withDefault bool) (*Handler, *protocol.MemoryUser) {
	validator := new(vless.MemoryValidator)
	id := uuid.New()
	u := &protocol.MemoryUser{Email: "reverse@example.com", Account: &vless.MemoryAccount{
		ID: protocol.NewID(id), Reverse: &vless.Reverse{Tag: "reverse-tag"},
	}}
	if err := validator.Add(u); err != nil {
		panic(err)
	}

	return &Handler{ctx: context.Background(), validator: validator, outboundHandlerManager: m}, u
}

func TestReverseConcurrentGetCreatesOne(t *testing.T) {
	m := newFakeOutboundManager(true)
	h, u := reverseTestHandler(m, true)
	const n = 32
	results := make(chan *Reverse, n)
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, err := h.GetReverse(u.Account.(*vless.MemoryAccount))
			results <- r
			errs <- err
		}()
	}
	wg.Wait()
	close(results)
	close(errs)
	var first *Reverse
	for r := range results {
		if r == nil {
			t.Fatalf("concurrent admission returned nil reverse")
		}
		if first == nil {
			first = r
		} else if first != r {
			t.Fatalf("created multiple reverse handlers")
		}
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("GetReverse: %v", err)
		}
	}
	m.mu.Lock()
	adds := m.addCalls
	count := len(m.handlers)
	m.mu.Unlock()
	if adds != 1 || count != 2 {
		t.Fatalf("adds=%d handlers=%d, want one reverse plus default", adds, count)
	}
	_ = h.Close()
}

func TestReverseCloseRejectsNewGet(t *testing.T) {
	m := newFakeOutboundManager(true)
	h, u := reverseTestHandler(m, true)
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err != nil {
		t.Fatal(err)
	}
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err == nil {
		t.Fatal("GetReverse after Close succeeded")
	}
}

func TestReverseAddFailureLeavesNoRegistration(t *testing.T) {
	m := newFakeOutboundManager(true)
	m.failAdd.Store(true)
	h, u := reverseTestHandler(m, true)
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err == nil {
		t.Fatal("expected AddHandler failure")
	}
	if len(h.reverses) != 0 {
		t.Fatalf("failed admission retained map entry: %d", len(h.reverses))
	}
	if got := len(m.ListHandlers(context.Background())); got != 1 {
		t.Fatalf("failed admission registered handler; handlers=%d", got)
	}
	m.mu.Lock()
	calls := m.addCalls
	m.mu.Unlock()
	if calls != 1 {
		t.Fatalf("AddHandler calls=%d, want 1", calls)
	}
	_ = h.Close()
}

func TestReverseRemoveFailureRetainsOwnershipAndCloseRetries(t *testing.T) {
	m := newFakeOutboundManager(true)
	h, u := reverseTestHandler(m, true)
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err != nil {
		t.Fatal(err)
	}
	m.failRemove.Store(true)
	if err := h.RemoveReverse(u); err == nil {
		t.Fatal("expected RemoveHandler failure")
	}
	if h.reverses[u.Account.(*vless.MemoryAccount).Reverse.Tag] == nil {
		t.Fatal("failed removal lost ownership")
	}
	if got, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err == nil || got != nil {
		t.Fatalf("GetReverse reused closed reverse after failed removal: got=%v err=%v", got, err)
	}
	m.failRemove.Store(false)
	if err := h.Close(); err != nil {
		t.Fatal(err)
	}
	if len(h.reverses) != 0 || m.GetHandler("reverse-tag") != nil {
		t.Fatal("retry did not remove owned handler")
	}
	m.mu.Lock()
	calls := m.removeCalls
	m.mu.Unlock()
	if calls != 2 {
		t.Fatalf("RemoveHandler calls=%d, want failed attempt plus retry", calls)
	}
}

func TestReverseRemoveDoesNotDeleteReplacement(t *testing.T) {
	m := newFakeOutboundManager(true)
	h, u := reverseTestHandler(m, true)
	owned, err := h.GetReverse(u.Account.(*vless.MemoryAccount))
	if err != nil {
		t.Fatal(err)
	}
	replacement := &fakeOutboundHandler{tag: "reverse-tag"}
	m.mu.Lock()
	m.handlers["reverse-tag"] = replacement
	m.mu.Unlock()
	if err := h.RemoveReverse(u); err != nil {
		t.Fatal(err)
	}
	if got := m.GetHandler("reverse-tag"); got != replacement {
		t.Fatal("replacement handler was removed")
	}
	if len(h.reverses) != 0 {
		t.Fatal("stale ownership remained after replacement")
	}
	if !owned.closed.Load() {
		t.Fatal("old owner was not closed")
	}
	_ = h.Close()
}

func TestReverseRemoveUserDeletesValidatorOnlyAfterRemoval(t *testing.T) {
	m := newFakeOutboundManager(true)
	h, u := reverseTestHandler(m, true)
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err != nil {
		t.Fatal(err)
	}
	m.failRemove.Store(true)
	if err := h.RemoveUser(context.Background(), u.Email); err == nil {
		t.Fatal("expected RemoveUser removal failure")
	}
	if h.GetUser(context.Background(), u.Email) == nil {
		t.Fatal("RemoveUser deleted validator entry after failed removal")
	}
	m.failRemove.Store(false)
	if err := h.RemoveUser(context.Background(), u.Email); err != nil {
		t.Fatal(err)
	}
	if h.GetUser(context.Background(), u.Email) != nil {
		t.Fatal("successful RemoveUser retained validator entry")
	}
	_ = h.Close()
}

func TestReverseNoDefaultIsBoundedAndCanRetry(t *testing.T) {
	m := newFakeOutboundManager(false)
	h, u := reverseTestHandler(m, false)
	start := time.Now()
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err == nil {
		t.Fatal("expected missing-default error")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("missing-default admission blocked for %v", elapsed)
	}
	if len(h.reverses) != 0 {
		t.Fatal("missing-default admission retained reverse")
	}
	m.mu.Lock()
	m.handlers["default"] = &fakeOutboundHandler{tag: "default"}
	m.mu.Unlock()
	if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err != nil {
		t.Fatalf("retry after default: %v", err)
	}
	_ = h.Close()
}

func TestReverseManagerAndInboundConcurrentClose(t *testing.T) {
	for iteration := 0; iteration < 20; iteration++ {
		m, err := manageroutbound.New(context.Background(), &proxyman.OutboundConfig{})
		if err != nil {
			t.Fatal(err)
		}
		if err := m.AddHandler(context.Background(), &fakeOutboundHandler{tag: "default"}); err != nil {
			t.Fatal(err)
		}
		h, u := reverseTestHandler(m, false)
		if _, err := h.GetReverse(u.Account.(*vless.MemoryAccount)); err != nil {
			t.Fatal(err)
		}
		results := make(chan error, 2)
		go func() { results <- m.Close() }()
		go func() { results <- h.Close() }()
		for i := 0; i < 2; i++ {
			select {
			case err := <-results:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("manager and inbound close deadlocked")
			}
		}
	}
}
