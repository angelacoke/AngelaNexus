package log

import (
	"bytes"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	logrus "github.com/sirupsen/logrus"
)

// CI copies this into the pinned upstream log package. No finalizer scheduling
// or sleep is needed to exercise the same SetLevel/print race as proxy Close.
func TestAngelaNexusLogLevelConcurrentReadsWritesAndPrint(t *testing.T) {
	oldLevel := Level()
	logger := logrus.StandardLogger()
	oldOutput := logger.Out
	logger.SetOutput(io.Discard)
	defer func() { SetLevel(oldLevel); logger.SetOutput(oldOutput) }()
	start := make(chan struct{})
	var workers sync.WaitGroup
	for worker := 0; worker < 12; worker++ {
		workers.Add(1)
		go func(worker int) {
			defer workers.Done()
			<-start
			for iteration := 0; iteration < 256; iteration++ {
				switch worker % 3 {
				case 0:
					SetLevel([]LogLevel{DEBUG, INFO, WARNING, ERROR, SILENT}[iteration%5])
				case 1:
					if got := Level(); got < DEBUG || got > SILENT {
						t.Errorf("invalid observed level %d", got)
					}
				case 2:
					print(Event{LogLevel: DEBUG, Payload: "concurrent proxy-finalizer logging"})
				}
			}
		}(worker)
	}
	close(start)
	workers.Wait()
	SetLevel(WARNING)
	if got := Level(); got != WARNING {
		t.Fatalf("last completed write = %v, want warning", got)
	}
}

func TestAngelaNexusLogLevelPreservesFilteringAndValues(t *testing.T) {
	oldLevel := Level()
	logger := logrus.StandardLogger()
	oldOutput := logger.Out
	var output bytes.Buffer
	logger.SetOutput(&output)
	defer func() { SetLevel(oldLevel); logger.SetOutput(oldOutput) }()
	for _, value := range []LogLevel{DEBUG, INFO, WARNING, ERROR, SILENT, -1, 12345} {
		SetLevel(value)
		if got := Level(); got != value {
			t.Fatalf("SetLevel(%d) round trip = %d", value, got)
		}
	}
	SetLevel(WARNING)
	print(Event{LogLevel: DEBUG, Payload: "filtered-debug-marker"})
	print(Event{LogLevel: INFO, Payload: "filtered-info-marker"})
	print(Event{LogLevel: WARNING, Payload: "visible-warning-marker"})
	if text := output.String(); strings.Contains(text, "filtered-") || !strings.Contains(text, "visible-warning-marker") {
		t.Fatalf("warning threshold changed: %q", text)
	}
	output.Reset()
	SetLevel(SILENT)
	for _, value := range []LogLevel{DEBUG, INFO, WARNING, ERROR} {
		print(Event{LogLevel: value, Payload: "must-be-silent"})
	}
	if output.Len() != 0 {
		t.Fatalf("silent threshold emitted output: %q", output.String())
	}
}

type angelaNexusReentrantLogWriter struct{}

func (angelaNexusReentrantLogWriter) Write(data []byte) (int, error) {
	// Output/hooks must be outside the level mutex: they can change the level.
	SetLevel(SILENT)
	return len(data), nil
}

func TestAngelaNexusLogLevelOutputCanReenterSetter(t *testing.T) {
	oldLevel := Level()
	logger := logrus.StandardLogger()
	oldOutput := logger.Out
	logger.SetOutput(angelaNexusReentrantLogWriter{})
	defer func() { SetLevel(oldLevel); logger.SetOutput(oldOutput) }()
	SetLevel(DEBUG)
	done := make(chan struct{})
	go func() {
		defer close(done)
		print(Event{LogLevel: INFO, Payload: "reentrant output"})
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("log output deadlocked while reentering SetLevel")
	}
	if got := Level(); got != SILENT {
		t.Fatalf("reentrant setter did not complete: %v", got)
	}
}
