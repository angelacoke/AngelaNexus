package outbound

import (
	"context"
	"errors"
	"testing"
	"time"
)

type lifecycleTestConn struct {
	closed chan struct{}
}

func (c *lifecycleTestConn) Close() error {
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
	return nil
}

type lifecycleTestPipe struct {
	interrupted chan struct{}
}

func (p *lifecycleTestPipe) Interrupt() {
	select {
	case <-p.interrupted:
	default:
		close(p.interrupted)
	}
}

func TestRunVLESSTasksAndWaitJoinsSiblingAfterFirstError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn := &lifecycleTestConn{closed: make(chan struct{})}
	reader := &lifecycleTestPipe{interrupted: make(chan struct{})}
	writer := &lifecycleTestPipe{interrupted: make(chan struct{})}
	started := make(chan struct{})
	released := make(chan struct{})
	wantErr := errors.New("first task failed")

	done := make(chan error, 1)
	go func() {
		done <- runVLESSTasksAndWait(ctx, cancel, nil, conn, reader, writer,
			func() error { return wantErr }, func() error {
				close(started)
				<-reader.interrupted
				time.Sleep(25 * time.Millisecond)
				close(released)
				return nil
			})
	}()
	<-started
	select {
	case <-released:
		t.Fatal("sibling released before the helper observed the first error")
	default:
	}
	select {
	case err := <-done:
		t.Fatalf("helper returned before sibling release: %v", err)
	case <-time.After(5 * time.Millisecond):
	}
	if err := <-done; !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("helper returned before sibling task released")
	}
	select {
	case <-conn.closed:
	default:
		t.Fatal("connection was not closed")
	}
}

func TestRunVLESSTasksAndWaitJoinsSiblingAfterParentCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	conn := &lifecycleTestConn{closed: make(chan struct{})}
	reader := &lifecycleTestPipe{interrupted: make(chan struct{})}
	writer := &lifecycleTestPipe{interrupted: make(chan struct{})}
	released := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- runVLESSTasksAndWait(ctx, func() {}, nil, conn, reader, writer,
			func() error {
				<-ctx.Done()
				return ctx.Err()
			}, func() error {
				<-reader.interrupted
				time.Sleep(25 * time.Millisecond)
				close(released)
				return nil
			})
	}()
	cancel()
	select {
	case err := <-done:
		t.Fatalf("helper returned before sibling release: %v", err)
	case <-time.After(5 * time.Millisecond):
	}
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	select {
	case <-released:
	case <-time.After(time.Second):
		t.Fatal("helper returned before sibling task released")
	}
}

func TestRunVLESSTasksAndWaitNormalCompletion(t *testing.T) {
	conn := &lifecycleTestConn{closed: make(chan struct{})}
	reader := &lifecycleTestPipe{interrupted: make(chan struct{})}
	writer := &lifecycleTestPipe{interrupted: make(chan struct{})}
	if err := runVLESSTasksAndWait(context.Background(), func() {}, nil, conn, reader, writer,
		func() error { return nil }, func() error { return nil }); err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
}
