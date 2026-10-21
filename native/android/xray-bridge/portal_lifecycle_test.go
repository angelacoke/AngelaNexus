package reverse

import (
	"context"
	"github.com/xtls/xray-core/common/buf"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/xtls/xray-core/common/mux"
	"github.com/xtls/xray-core/features/outbound"
	"github.com/xtls/xray-core/transport"
	"github.com/xtls/xray-core/transport/pipe"
)

func portalTestWorker(t *testing.T) *PortalWorker {
	t.Helper()
	r, _ := pipe.New(pipe.WithSizeLimit(1))
	_, w := pipe.New(pipe.WithSizeLimit(1))
	c, err := mux.NewClientWorker(transport.Link{Reader: r, Writer: w}, mux.ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	worker, err := NewPortalWorker(c)
	if err != nil {
		c.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { worker.Close() })
	return worker
}
func portalTestWait(t *testing.T, done <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatalf("%s did not exit", label)
	}
}
func TestPortalPickerCloseJoinsAndRejectsLateWorker(t *testing.T) {
	p, _ := NewStaticMuxPicker()
	workers := []*PortalWorker{portalTestWorker(t), portalTestWorker(t)}
	for _, w := range workers {
		if err := p.AddWorker(w); err != nil {
			t.Fatal(err)
		}
	}
	finished := make(chan struct{})
	go func() { p.Close(); close(finished) }()
	portalTestWait(t, finished, "picker close")
	portalTestWait(t, p.done, "cleanup loop")
	for _, w := range workers {
		portalTestWait(t, w.done, "heartbeat and mux worker")
		if !w.Closed() {
			t.Fatal("worker not closed")
		}
	}
	if _, err := p.PickAvailable(); err == nil {
		t.Fatal("closed picker admitted dispatch")
	}
	late := portalTestWorker(t)
	if err := p.AddWorker(late); err == nil {
		t.Fatal("closed picker admitted late worker")
	}
	portalTestWait(t, late.done, "rejected worker")
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestPortalPickerConcurrentAddPickDrainCleanupClose(t *testing.T) {
	for iteration := 0; iteration < 10; iteration++ {
		p, _ := NewStaticMuxPicker()
		workers := make([]*PortalWorker, 8)
		for i := range workers {
			workers[i] = portalTestWorker(t)
		}
		var wg sync.WaitGroup
		for _, w := range workers {
			wg.Add(1)
			go func(w *PortalWorker) {
				defer wg.Done()
				p.AddWorker(w)
				for i := 0; i < 20; i++ {
					w.draining.Store(i%2 == 0)
					p.PickAvailable()
				}
			}(w)
		}
		wg.Add(2)
		go func() { defer wg.Done(); p.cleanup(); p.Close() }()
		go func() { defer wg.Done(); p.Close() }()
		done := make(chan struct{})
		go func() { wg.Wait(); close(done) }()
		portalTestWait(t, done, "concurrent picker operations")
		for _, w := range workers {
			portalTestWait(t, w.done, "owned or rejected worker")
		}
	}
}
func TestPortalCleanupJoinsSignaledWorker(t *testing.T) {
	p, _ := NewStaticMuxPicker()
	defer p.Close()
	w := portalTestWorker(t)
	p.AddWorker(w)
	w.client.Close()
	if err := p.cleanup(); err != nil {
		t.Fatal(err)
	}
	portalTestWait(t, w.done, "cleaned worker")
	if len(p.workers) != 0 {
		t.Fatal("cleanup retained closed worker")
	}
}
func TestPortalWorkerFailedDispatchReleasesClient(t *testing.T) {
	r, _ := pipe.New()
	_, w := pipe.New()
	c, err := mux.NewClientWorker(transport.Link{Reader: r, Writer: w}, mux.ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	c.Close()
	if _, err := NewPortalWorker(c); err == nil {
		t.Fatal("control dispatch unexpectedly accepted closed client")
	}
	if !c.Closed() {
		t.Fatal("failed constructor left client open")
	}
}

// These tests exercise the owned loop with short injected durations; production
// still uses the pinned 2s heartbeat / 24h inactivity policy.
type portalFailWriter struct{}

func (portalFailWriter) WriteMultiBuffer(mb buf.MultiBuffer) error {
	buf.ReleaseMulti(mb)
	return io.ErrClosedPipe
}
func TestPortalHeartbeatFailureIdleTimeoutJoins(t *testing.T) {
	r, _ := pipe.New()
	_, out := pipe.New()
	c, err := mux.NewClientWorker(transport.Link{Reader: r, Writer: out}, mux.ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	control, _ := pipe.New()
	ctx, cancel := context.WithCancel(context.Background())
	w := &PortalWorker{client: c, writer: portalFailWriter{}, reader: control, cancel: cancel, done: make(chan struct{})}
	go w.run(ctx, time.Millisecond, 10*time.Millisecond)
	portalTestWait(t, w.done, "failed heartbeat idle timer")
	if !c.Closed() {
		t.Fatal("idle timer failed to close mux client")
	}
	w.Close()
}

type portalBlockingWriter struct {
	entered  chan struct{}
	released chan struct{}
	once     sync.Once
}

func (w *portalBlockingWriter) WriteMultiBuffer(mb buf.MultiBuffer) error {
	defer buf.ReleaseMulti(mb)
	close(w.entered)
	<-w.released
	return io.ErrClosedPipe
}
func (w *portalBlockingWriter) Interrupt() { w.once.Do(func() { close(w.released) }) }
func TestPortalCloseInterruptsAndJoinsBlockedHeartbeat(t *testing.T) {
	r, _ := pipe.New()
	_, out := pipe.New()
	c, err := mux.NewClientWorker(transport.Link{Reader: r, Writer: out}, mux.ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	reader, _ := pipe.New()
	writer := &portalBlockingWriter{entered: make(chan struct{}), released: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	w := &PortalWorker{client: c, writer: writer, reader: reader, cancel: cancel, done: make(chan struct{})}
	go w.run(ctx, time.Second, time.Hour)
	portalTestWait(t, writer.entered, "heartbeat writer entry")
	done := make(chan struct{})
	go func() { w.Close(); close(done) }()
	portalTestWait(t, done, "blocked heartbeat close")
	if !c.Closed() {
		t.Fatal("blocked heartbeat close left mux open")
	}
}

type portalOwnerManager struct {
	outbound.Manager
	current    outbound.Handler
	failAdd    bool
	failRemove bool
}

func (m *portalOwnerManager) AddHandler(_ context.Context, h outbound.Handler) error {
	if m.failAdd {
		return io.ErrClosedPipe
	}
	m.current = h
	return nil
}
func (m *portalOwnerManager) RemoveHandlerIf(_ context.Context, _ string, owner outbound.Handler) error {
	if m.failRemove {
		return io.ErrClosedPipe
	}
	if m.current == owner {
		m.current = nil
	}
	return nil
}
func TestPortalFailedStartClosesPicker(t *testing.T) {
	m := &portalOwnerManager{failAdd: true}
	p, err := NewPortal(&PortalConfig{Tag: "p", Domain: "portal.test"}, m)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.Start(); err == nil {
		t.Fatal("expected failed registration")
	}
	portalTestWait(t, p.picker.done, "failed-start picker")
	if err := p.Start(); err == nil {
		t.Fatal("failed start resurrected portal")
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestPortalCloseRetainsRemovalResponsibility(t *testing.T) {
	m := &portalOwnerManager{}
	p, _ := NewPortal(&PortalConfig{Tag: "p", Domain: "portal.test"}, m)
	if err := p.Start(); err != nil {
		t.Fatal(err)
	}
	m.failRemove = true
	if err := p.Close(); err == nil {
		t.Fatal("expected remove error")
	}
	if !p.registered {
		t.Fatal("failed removal forgot owner")
	}
	portalTestWait(t, p.picker.done, "closed picker before removal retry")
	replacement := &Outbound{tag: "p"}
	m.current = replacement
	m.failRemove = false
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	if p.registered {
		t.Fatal("successful retry retained ownership")
	}
	if m.current != replacement {
		t.Fatal("retry removed replacement owner")
	}
}
