package xray

import (
	"context"
	"fmt"
	"io"
	"net"
	"runtime"
	"strings"
	"testing"
	"time"

	xnet "github.com/xtls/xray-core/common/net"
	"github.com/xtls/xray-core/core"
)

const (
	muxStopTimeout    = 5 * time.Second
	peerEOFTimeout    = 4 * time.Second
	workerExitTimeout = 4 * time.Second
)

// muxStopListener is deliberately a real TCP peer.  It owns every accepted
// connection and its accept loop, so an error path cannot strand an Accept
// goroutine or a peer socket.
type muxStopListener struct {
	listener net.Listener
	accepted chan net.Conn
	closing  chan struct{}
	done     chan struct{}
}

func newMuxStopListener(t *testing.T) *muxStopListener {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen mux peer: %v", err)
	}
	m := &muxStopListener{
		listener: listener,
		accepted: make(chan net.Conn, 4),
		closing:  make(chan struct{}),
		done:     make(chan struct{}),
	}
	go func() {
		defer close(m.done)
		for {
			conn, err := listener.Accept()
			if err != nil {
				select {
				case <-m.closing:
					return
				default:
					t.Logf("mux peer accept stopped with unexpected error: %v", err)
					return
				}
			}
			select {
			case m.accepted <- conn:
			case <-m.closing:
				_ = conn.Close()
				return
			}
		}
	}()
	return m
}

func (m *muxStopListener) close(t *testing.T) {
	t.Helper()
	select {
	case <-m.closing:
	default:
		close(m.closing)
	}
	_ = m.listener.Close()
	for {
		select {
		case conn := <-m.accepted:
			if conn != nil {
				_ = conn.Close()
			}
		default:
			select {
			case <-m.done:
			case <-time.After(time.Second):
				t.Errorf("mux peer accept goroutine did not exit")
			}
			return
		}
	}
}

func (m *muxStopListener) next(t *testing.T) net.Conn {
	t.Helper()
	select {
	case conn := <-m.accepted:
		return conn
	case <-time.After(3 * time.Second):
		t.Errorf("mux transport was not dialed")
		return nil
	}
}

func muxWorkerStack() string {
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	return string(buf[:n])
}

func muxWorkersRunning(stack string) bool {
	for _, owner := range []string{
		"mux.(*ClientWorker).monitor",
		"mux.(*ClientWorker).fetchOutput",
		"vless/outbound.(*Handler).Process",
	} {
		if strings.Contains(stack, owner) {
			return true
		}
	}
	return false
}

func waitForMuxWorkersToExit(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(workerExitTimeout)
	for {
		stack := muxWorkerStack()
		if !muxWorkersRunning(stack) {
			return
		}
		if time.Now().After(deadline) {
			t.Errorf("owned mux workers remain after StopXray (monitor/fetchOutput/VLESS Process); stack:\n%s", stack)
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
}

// stopMuxGeneration returns false when the caller must not invoke another
// lifecycle API, notably when StopXray may still own coreServerMu.
func stopMuxGeneration(t *testing.T, peer *muxStopListener, config string) bool {
	t.Helper()
	if err := RunXray(config); err != nil {
		t.Errorf("RunXray: %v", err)
		return false
	}
	var client, remote net.Conn
	defer func() {
		if client != nil {
			_ = client.Close()
		}
		if remote != nil {
			_ = remote.Close()
		}
	}()

	client, err := core.Dial(context.Background(), coreServer, xnet.TCPDestination(xnet.LocalHostIP, 443))
	if err != nil {
		t.Errorf("dial VLESS mux outbound: %v", err)
		return stopMuxAfterStartup(t)
	}
	if _, err = client.Write([]byte("stop-mux-host-test")); err != nil {
		t.Errorf("write through VLESS mux: %v", err)
		return stopMuxAfterStartup(t)
	}
	remote = peer.next(t)
	if remote == nil {
		return stopMuxAfterStartup(t)
	}
	_ = remote.SetReadDeadline(time.Now().Add(3 * time.Second))
	initial := make([]byte, 4096)
	if _, err = remote.Read(initial); err != nil {
		t.Errorf("VLESS peer did not receive initial mux bytes: %v", err)
		return stopMuxAfterStartup(t)
	}

	// Read independently of application pipes. A clean peer EOF is the required
	// observation; a deadline is specifically a failure, not an approximation.
	peerResult := make(chan error, 1)
	_ = remote.SetReadDeadline(time.Now().Add(peerEOFTimeout))
	go func() {
		_, readErr := io.Copy(io.Discard, remote)
		peerResult <- readErr
	}()

	stopResult := make(chan error, 1)
	go func() { stopResult <- StopXray() }()
	var stopErr error
	select {
	case stopErr = <-stopResult:
	case <-time.After(muxStopTimeout):
		t.Errorf("StopXray hung for %s", muxStopTimeout)
		// Closing both ends releases the peer reader without waiting on a stuck
		// StopXray goroutine. The test returns rather than invoking StopXray again.
		_ = remote.Close()
		_ = client.Close()
		return false
	}
	if stopErr != nil {
		t.Errorf("StopXray: %v", stopErr)
		return false
	}
	if GetXrayState() {
		t.Errorf("GetXrayState remained true after successful StopXray")
		return false
	}

	select {
	case err = <-peerResult:
		if err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				t.Errorf("VLESS mux peer timed out instead of observing real EOF")
			} else {
				t.Errorf("VLESS mux peer observed non-EOF close: %v", err)
			}
		}
	case <-time.After(peerEOFTimeout + time.Second):
		t.Errorf("VLESS mux peer did not observe EOF after successful StopXray")
	}
	waitForMuxWorkersToExit(t)

	// Stop is idempotent and must not resurrect a native instance.
	if err := StopXray(); err != nil {
		t.Errorf("repeat StopXray: %v", err)
	}
	if GetXrayState() {
		t.Errorf("GetXrayState became true after repeat StopXray")
		return false
	}
	return !t.Failed()
}

// stopMuxAfterStartup is used on setup failures. It never permits a later
// generation, and bounds the cleanup call so a stuck coreServerMu is not
// re-entered by the caller.
func stopMuxAfterStartup(t *testing.T) bool {
	t.Helper()
	result := make(chan error, 1)
	go func() { result <- StopXray() }()
	select {
	case err := <-result:
		if err != nil {
			t.Errorf("cleanup StopXray: %v", err)
		}
	case <-time.After(muxStopTimeout):
		t.Errorf("cleanup StopXray hung for %s", muxStopTimeout)
	}
	return false
}

// This is a host test of libXray's lifecycle ownership. It does not claim to
// exercise an Android device, JNI, file descriptors, or complete kernel
// shutdown. It intentionally fails against the unmodified pinned core when
// that core leaves the admitted mux transport open.
func TestAngelaNexusStopClosesMuxTransport(t *testing.T) {
	peer := newMuxStopListener(t)
	defer peer.close(t)
	port := peer.listener.Addr().(*net.TCPAddr).Port
	config := fmt.Sprintf(`{"log":{"loglevel":"none"},"outbounds":[{"protocol":"vless","tag":"mux-proxy","settings":{"address":"127.0.0.1","port":%d,"id":"11111111-1111-1111-1111-111111111111","encryption":"none"},"mux":{"enabled":true,"concurrency":8}}]}`, port)

	// Two generations prove that successful stop does not leave mux ownership
	// behind and that a subsequent RunXray gets a fresh instance.
	for generation := 1; generation <= 2; generation++ {
		ok := true
		t.Run(fmt.Sprintf("generation-%d", generation), func(t *testing.T) {
			ok = stopMuxGeneration(t, peer, config)
		})
		if !ok {
			return
		}
	}
}
