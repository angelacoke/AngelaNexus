package resource

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func inotifyFDCount() (int, bool) {
	if runtime.GOOS != "linux" {
		return 0, false
	}
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return 0, false
	}
	count := 0
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join("/proc/self/fd", entry.Name()))
		if err == nil && len(target) >= len("anon_inode:inotify") && target == "anon_inode:inotify" {
			count++
		}
	}
	return count, true
}

func TestAngelaNexusProviderLifecycleCloseRejectsFileAndHTTPStart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "provider.yaml")
	if err := os.WriteFile(path, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}

	fileFetcher := NewFetcher[string]("file", time.Hour, NewFileVehicle(path), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	t.Cleanup(func() { _ = fileFetcher.Close() })
	if err := fileFetcher.Close(); err != nil {
		t.Fatal(err)
	}
	if err := fileFetcher.startPullLoop(false); !errors.Is(err, context.Canceled) {
		t.Fatalf("file start after Close error = %v, want context.Canceled", err)
	}

	// Initial is the public local-file path: parsing succeeds, but the closed
	// fetcher must reject the lifecycle start rather than silently restart.
	initialFetcher := NewFetcher[string]("file", time.Hour, NewFileVehicle(path), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	t.Cleanup(func() { _ = initialFetcher.Close() })
	_ = initialFetcher.Close()
	if _, err := initialFetcher.Initial(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Initial after Close error = %v, want context.Canceled", err)
	}

	httpFetcher := NewFetcher[string]("http", time.Hour,
		NewHTTPVehicle("http://127.0.0.1:1/provider", path, "", nil, time.Second, 0), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	t.Cleanup(func() { _ = httpFetcher.Close() })
	if err := httpFetcher.Close(); err != nil {
		t.Fatal(err)
	}
	if err := httpFetcher.startPullLoop(false); !errors.Is(err, context.Canceled) {
		t.Fatalf("HTTP start after Close error = %v, want context.Canceled", err)
	}
}

func TestAngelaNexusProviderLifecycleDuplicateFileStartKeepsWatcher(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "provider.yaml")
	if err := os.WriteFile(path, []byte("payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	fetcher := NewFetcher[string]("file", time.Hour, NewFileVehicle(path), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	baseline, haveFDs := inotifyFDCount()
	if err := fetcher.startPullLoop(false); err != nil {
		t.Fatal(err)
	}
	firstWatcher := fetcher.watcher
	if firstWatcher == nil {
		t.Fatal("first file start did not publish watcher state")
	}
	// Keep both references: if a broken duplicate start replaces the pointer,
	// closing only the current watcher would leak the original inotify FD.
	t.Cleanup(func() {
		_ = fetcher.Close()
		_ = firstWatcher.Close()
	})
	first, haveFirstFDs := inotifyFDCount()
	if haveFDs && (!haveFirstFDs || first != baseline+1) {
		t.Fatalf("first file start opened %d inotify FDs, want 1 (baseline=%d)", first-baseline, baseline)
	}

	if err := fetcher.startPullLoop(true); err != nil {
		t.Fatal(err)
	}
	secondWatcher := fetcher.watcher
	if secondWatcher != firstWatcher {
		t.Fatal("duplicate file start replaced the existing watcher")
	}
	if haveFDs {
		duplicate := mustInotifyFDCount(t)
		if duplicate != first {
			t.Fatalf("duplicate file start changed inotify FD count: first=%d after=%d", first, duplicate)
		}
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	if haveFDs && mustInotifyFDCount(t) != baseline {
		t.Fatalf("Close did not release watcher inotify FD: before=%d after=%d", baseline, mustInotifyFDCount(t))
	}
}

func mustInotifyFDCount(t *testing.T) int {
	t.Helper()
	count, ok := inotifyFDCount()
	if !ok {
		t.Fatal("/proc/self/fd became unavailable")
	}
	return count
}

func TestAngelaNexusProviderLifecycleConcurrentStartClose(t *testing.T) {
	for i := 0; i < 64; i++ {
		dir := t.TempDir()
		path := filepath.Join(dir, "provider.yaml")
		if err := os.WriteFile(path, []byte("payload"), 0o600); err != nil {
			t.Fatal(err)
		}
		fetcher := NewFetcher[string]("file", time.Hour, NewFileVehicle(path), nil,
			func(buf []byte) (string, error) { return string(buf), nil }, nil)
		t.Cleanup(func() { _ = fetcher.Close() })
		baseline, haveFDs := inotifyFDCount()
		var ready sync.WaitGroup
		ready.Add(2)
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			ready.Done()
			<-start
			_ = fetcher.startPullLoop(false)
		}()
		go func() {
			defer wg.Done()
			ready.Done()
			<-start
			_ = fetcher.Close()
		}()
		ready.Wait()
		close(start)
		wg.Wait()

		// Both operations have joined, so these pre-existing fields are safe to
		// inspect without synchronizing on adapter-only lifecycle fields.
		if fetcher.ctx.Err() == nil {
			t.Fatal("concurrent Close did not cancel the fetcher")
		}
		if haveFDs && mustInotifyFDCount(t) != baseline {
			t.Fatalf("concurrent Close missed watcher FD: before=%d after=%d", baseline, mustInotifyFDCount(t))
		}
		if err := fetcher.startPullLoop(false); !errors.Is(err, context.Canceled) {
			t.Fatalf("post-race start error = %v, want context.Canceled", err)
		}
	}
}

func TestAngelaNexusProviderLifecycleWaitClosedTimeoutAndRetry(t *testing.T) {
	fetcher := NewFetcher[string]("wait", time.Hour, NewFileVehicle(filepath.Join(t.TempDir(), "provider")), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	if err := fetcher.WaitClosed(context.Background()); err == nil {
		t.Fatal("WaitClosed before Close unexpectedly succeeded")
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	_ = fetcher.WaitClosed(ctx)
	if err := fetcher.WaitClosed(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := fetcher.SideUpdate([]byte("after-close")); !errors.Is(err, context.Canceled) {
		t.Fatalf("SideUpdate after Close = %v", err)
	}
}

func TestAngelaNexusProviderLifecycleCloseIsReentrantFromCallback(t *testing.T) {
	fetcher := NewFetcher[string]("reentrant", time.Hour, NewFileVehicle(filepath.Join(t.TempDir(), "provider")), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	fetcher.onUpdate = func(string) { _ = fetcher.Close() }
	if _, _, err := fetcher.SideUpdate([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if err := fetcher.WaitClosed(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func closeAngelaNexusTestServer(t *testing.T, server *httptest.Server) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		server.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("httptest server cleanup hung")
	}
}

func TestAngelaNexusProviderLifecycleHTTPWorkerCancelAndJoin(t *testing.T) {
	requestStarted := make(chan struct{})
	requestCanceled := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		close(requestStarted)
		<-r.Context().Done()
		close(requestCanceled)
	}))
	defer closeAngelaNexusTestServer(t, server)

	path := filepath.Join(t.TempDir(), "provider.yaml")
	fetcher := NewFetcher[string]("blocked-http", time.Hour,
		NewHTTPVehicle(server.URL, path, "", nil, time.Hour, 0), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, nil)
	if err := fetcher.startPullLoop(true); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requestStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("HTTP worker did not start its request")
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requestCanceled:
	case <-time.After(2 * time.Second):
		t.Fatal("Close did not cancel the HTTP request context")
	}
	if err := fetcher.WaitClosed(context.Background()); err != nil {
		t.Fatalf("WaitClosed after HTTP cancellation = %v", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("HTTP request count after worker join = %d, want 1", got)
	}
	if err := fetcher.startPullLoop(true); !errors.Is(err, context.Canceled) {
		t.Fatalf("duplicate start after Close = %v, want context.Canceled", err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("duplicate start issued extra HTTP request: count=%d", got)
	}
}

func TestAngelaNexusProviderLifecycleClosedAPIsRejectWithoutWriteOrCallback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "provider.yaml")
	var callbacks atomic.Int32
	fetcher := NewFetcher[string]("closed-apis", time.Hour, NewFileVehicle(path), nil,
		func(buf []byte) (string, error) { return string(buf), nil },
		func(string) { callbacks.Add(1) })
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := fetcher.Initial(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Initial after Close = %v, want context.Canceled", err)
	}
	if _, _, err := fetcher.Update(); !errors.Is(err, context.Canceled) {
		t.Fatalf("Update after Close = %v, want context.Canceled", err)
	}
	if _, _, err := fetcher.SideUpdate([]byte("after-close")); !errors.Is(err, context.Canceled) {
		t.Fatalf("SideUpdate after Close = %v, want context.Canceled", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("closed API unexpectedly wrote %q (stat err=%v)", path, err)
	}
	if got := callbacks.Load(); got != 0 {
		t.Fatalf("closed API invoked callback %d times", got)
	}
}

func TestAngelaNexusProviderLifecycleBlockedParserWaitsForWorkerJoin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "provider.yaml")
	parserEntered := make(chan struct{})
	releaseParser := make(chan struct{})
	var writes atomic.Int32
	fetcher := NewFetcher[string]("blocked-parser", time.Hour, &countingFileVehicle{
		FileVehicle: NewFileVehicle(path), writes: &writes,
	}, nil, func(buf []byte) (string, error) {
		close(parserEntered)
		<-releaseParser
		return string(buf), nil
	}, nil)
	result := make(chan error, 1)
	go func() {
		_, _, err := fetcher.SideUpdate([]byte("payload"))
		result <- err
	}()
	select {
	case <-parserEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("parser did not start")
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := fetcher.WaitClosed(waitCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("WaitClosed while parser is blocked = %v, want deadline exceeded", err)
	}
	close(releaseParser)
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("blocked SideUpdate after cancellation = %v, want context.Canceled", err)
	}
	if err := fetcher.WaitClosed(context.Background()); err != nil {
		t.Fatalf("WaitClosed after parser release = %v", err)
	}
	if got := writes.Load(); got != 0 {
		t.Fatalf("canceled parser path wrote %d files", got)
	}
}

func TestAngelaNexusProviderLifecycleParserErrorDoesNotHang(t *testing.T) {
	fetcher := NewFetcher[string]("parser-error", time.Hour, NewFileVehicle(filepath.Join(t.TempDir(), "provider.yaml")), nil,
		func([]byte) (string, error) { return "", errors.New("parser failure") }, nil)
	result := make(chan error, 1)
	go func() {
		_, _, err := fetcher.SideUpdate([]byte("payload"))
		result <- err
	}()
	select {
	case err := <-result:
		if err == nil || err.Error() != "parser failure" {
			t.Fatalf("parser error = %v, want parser failure", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SideUpdate hung after parser returned an error")
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
}

type countingFileVehicle struct {
	*FileVehicle
	writes *atomic.Int32
}

func (v *countingFileVehicle) Write(buf []byte) error {
	v.writes.Add(1)
	return v.FileVehicle.Write(buf)
}

func TestAngelaNexusProviderLifecycleAdmittedCallbackMustDrain(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	var calls atomic.Int32
	fetcher := NewFetcher[string]("blocked-callback", time.Hour, NewFileVehicle(filepath.Join(t.TempDir(), "provider")), nil,
		func(buf []byte) (string, error) { return string(buf), nil }, func(string) {
			calls.Add(1)
			close(entered)
			<-release
		})
	defer func() {
		releaseOnce.Do(func() { close(release) })
		_ = fetcher.Close()
		_ = fetcher.WaitClosed(context.Background())
	}()
	updated := make(chan struct{})
	go func() {
		defer close(updated)
		_, _, _ = fetcher.SideUpdate([]byte("payload"))
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("callback did not enter")
	}
	if err := fetcher.Close(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := fetcher.WaitClosed(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("drain ignored admitted callback: %v", err)
	}
	releaseOnce.Do(func() { close(release) })
	if err := fetcher.WaitClosed(context.Background()); err != nil {
		t.Fatal(err)
	}
	<-updated
	if _, _, err := fetcher.SideUpdate([]byte("late")); !errors.Is(err, context.Canceled) {
		t.Fatalf("late update was admitted: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("callback count after drain = %d, want 1", calls.Load())
	}
}
