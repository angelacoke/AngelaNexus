package mux

import (
	"context"
	"github.com/xtls/xray-core/common/buf"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/common/session"
	"github.com/xtls/xray-core/transport"
	"github.com/xtls/xray-core/transport/internet"
	"github.com/xtls/xray-core/transport/pipe"
)

type lifecycleBlockingOutbound struct {
	entered  chan struct{}
	canceled chan struct{}
	release  chan struct{}
	once     sync.Once
}

func (p *lifecycleBlockingOutbound) Process(ctx context.Context, _ *transport.Link, _ internet.Dialer) error {
	p.once.Do(func() { close(p.entered) })
	<-ctx.Done()
	close(p.canceled)
	<-p.release
	return nil
}

func lifecycleContext() context.Context {
	return session.ContextWithOutbounds(context.Background(), []*session.Outbound{{
		Target: net.TCPDestination(net.DomainAddress("example.com"), 443),
	}})
}

// newLifecyclePicker uses a manually-created worker so tests can exercise
// admission and pipe interruption without involving a real outbound dial.
func newLifecyclePicker(t *testing.T) (*IncrementalWorkerPicker, *ClientWorker) {
	t.Helper()
	r, w := pipe.New(pipe.WithoutSizeLimit())
	worker, err := NewClientWorker(transport.Link{Reader: r, Writer: w}, ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	picker := &IncrementalWorkerPicker{Factory: lifecycleFactory{worker: worker}}
	return picker, worker
}

type lifecycleFactory struct{ worker *ClientWorker }

func (f lifecycleFactory) Create() (*ClientWorker, error) { return f.worker, nil }

func TestClientManagerCloseNilAndEmptyIsSafe(t *testing.T) {
	var nilManager *ClientManager
	if err := nilManager.Close(); err != nil {
		t.Fatal(err)
	}
	for _, manager := range []*ClientManager{{}, {Enabled: false}} {
		if err := manager.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestClientManagerCloseClosesPickerAndRejectsNewWorkers(t *testing.T) {
	picker, worker := newLifecyclePicker(t)
	manager := &ClientManager{Picker: picker}
	if _, err := picker.PickAvailable(); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if !worker.Closed() {
		t.Fatal("worker was not closed")
	}
	if _, err := picker.PickAvailable(); err == nil {
		t.Fatal("closed picker admitted a worker")
	}
}

func TestClientWorkerCloseWaitsForFactoryProcess(t *testing.T) {
	proxy := &lifecycleBlockingOutbound{entered: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{})}
	factory := &DialingWorkerFactory{Proxy: proxy, Strategy: ClientStrategy{}}
	picker := &IncrementalWorkerPicker{Factory: factory}
	if _, err := picker.PickAvailable(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-proxy.entered:
	case <-time.After(time.Second):
		t.Fatal("factory Process did not start")
	}

	closed := make(chan struct{})
	go func() { _ = picker.Close(); close(closed) }()
	select {
	case <-closed:
		t.Fatal("Close returned before Process was released")
	case <-time.After(50 * time.Millisecond):
	}
	select {
	case <-proxy.canceled:
	case <-time.After(time.Second):
		t.Fatal("factory Process context was not canceled")
	}
	close(proxy.release)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close did not wait for Process completion")
	}
}

func TestIncrementalPickerCleanupKeepsSignaledWorkerUntilJoined(t *testing.T) {
	proxy := &lifecycleBlockingOutbound{entered: make(chan struct{}), canceled: make(chan struct{}), release: make(chan struct{})}
	factory := &DialingWorkerFactory{Proxy: proxy, Strategy: ClientStrategy{}}
	picker := &IncrementalWorkerPicker{Factory: factory}
	worker, err := picker.PickAvailable()
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-proxy.entered:
	case <-time.After(time.Second):
		t.Fatal("factory Process did not start")
	}
	if err := worker.done.Close(); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { picker.cleanup(); close(finished) }()
	select {
	case <-finished:
		t.Fatal("cleanup discarded a signaled worker before it joined")
	case <-time.After(50 * time.Millisecond):
	}
	select {
	case <-proxy.canceled:
	case <-time.After(time.Second):
		t.Fatal("factory Process context was not canceled")
	}
	close(proxy.release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cleanup did not join worker")
	}
}

func TestIncrementalPickerConcurrentPickDispatchClose(t *testing.T) {
	picker, _ := newLifecyclePicker(t)
	manager := &ClientManager{Picker: picker}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				r, w := pipe.New(pipe.WithoutSizeLimit())
				_ = manager.Dispatch(lifecycleContext(), &transport.Link{Reader: r, Writer: w})
				_ = w.Close()
			}
		}()
	}
	closeDone := make(chan struct{})
	go func() { _ = manager.Close(); close(closeDone) }()
	wg.Wait()
	select {
	case <-closeDone:
	case <-time.After(time.Second):
		t.Fatal("concurrent Close did not finish")
	}
	if _, err := picker.PickAvailable(); err == nil {
		t.Fatal("picker admitted worker after Close")
	}
}

// The input goroutine deliberately acknowledges interruption but delays return.
// A shutdown signal alone is insufficient: Close must join the admitted input.
type lifecycleDelayedReader struct {
	entered, interrupted, release chan struct{}
	once                          sync.Once
}

func (r *lifecycleDelayedReader) ReadMultiBuffer() (buf.MultiBuffer, error) {
	r.once.Do(func() { close(r.entered) })
	<-r.release
	return nil, io.EOF
}

func (r *lifecycleDelayedReader) Interrupt() { close(r.interrupted) }

func TestClientWorkerCloseWaitsForAdmittedInput(t *testing.T) {
	downReader, downWriter := pipe.New(pipe.WithoutSizeLimit())
	upReader, upWriter := pipe.New(pipe.WithoutSizeLimit())
	defer downWriter.Close()
	defer upReader.Interrupt()
	worker, err := NewClientWorker(transport.Link{Reader: downReader, Writer: upWriter}, ClientStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	input := &lifecycleDelayedReader{entered: make(chan struct{}), interrupted: make(chan struct{}), release: make(chan struct{})}
	outReader, outWriter := pipe.New(pipe.WithoutSizeLimit())
	defer outReader.Interrupt()
	// Dispatch on a non-pipe input waits for the session, independently of the
	// fetchInput goroutine whose lifetime Close must own.
	dispatched := make(chan struct{})
	go func() {
		worker.Dispatch(lifecycleContext(), &transport.Link{Reader: input, Writer: outWriter})
		close(dispatched)
	}()
	select {
	case <-input.entered:
	case <-time.After(time.Second):
		t.Fatal("input did not start")
	}
	closed := make(chan struct{})
	go func() { worker.Close(); close(closed) }()
	select {
	case <-input.interrupted:
	case <-time.After(time.Second):
		t.Fatal("input was not interrupted")
	}
	select {
	case <-closed:
		t.Fatal("Close returned before admitted input exited")
	case <-time.After(25 * time.Millisecond):
	}
	close(input.release)
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Close did not join input")
	}
	select {
	case <-dispatched:
	case <-time.After(time.Second):
		t.Fatal("Dispatch did not finish")
	}
}
