package resource

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
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
