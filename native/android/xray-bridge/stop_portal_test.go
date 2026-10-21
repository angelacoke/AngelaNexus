package xray

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// This uses the supported VLESS reverse handshake, not removed legacy
// reverse.portals config or direct feature injection. A real TCP control
// heartbeat proves that NewPortalWorker was reached before StopXray.
func TestAngelaNexusStopClosesPortalTransport(t *testing.T) {
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := reserved.Addr().(*net.TCPAddr).Port
	reserved.Close()
	config := fmt.Sprintf(`{"log":{"loglevel":"none"},"inbounds":[{"listen":"127.0.0.1","port":%d,"protocol":"vless","settings":{"clients":[{"id":"11111111-1111-1111-1111-111111111111","reverse":{"tag":"portal"}}],"decryption":"none"}}],"outbounds":[{"protocol":"freedom","tag":"direct"}]}`, port)
	for generation := 0; generation < 2; generation++ {
		if err := RunXray(config); err != nil {
			t.Fatal(err)
		}
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second)
		if err != nil {
			stopMuxAfterStartup(t)
			t.Fatal(err)
		}
		header := []byte{0}
		for i := 0; i < 16; i++ {
			header = append(header, 0x11)
		}
		header = append(header, 0, 4)
		if _, err := conn.Write(header); err != nil {
			conn.Close()
			stopMuxAfterStartup(t)
			t.Fatal(err)
		}
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		// Response header is 2 bytes; require mux control frame bytes beyond it.
		initial := make([]byte, 10)
		if _, err := io.ReadFull(conn, initial); err != nil {
			conn.Close()
			stopMuxAfterStartup(t)
			t.Fatalf("Portal control heartbeat never reached admitted TCP transport: %v", err)
		}
		stopped := make(chan error, 1)
		go func() { stopped <- StopXray() }()
		select {
		case err := <-stopped:
			if err != nil {
				conn.Close()
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			conn.Close()
			t.Fatal("Portal StopXray did not return")
		}
		if GetXrayState() {
			conn.Close()
			t.Fatal("Portal StopXray left running state true")
		}
		conn.SetReadDeadline(time.Now().Add(time.Second))
		if _, err := io.Copy(io.Discard, conn); err != nil {
			t.Errorf("Portal peer did not observe clean EOF after StopXray: %v", err)
		}
		// Check before closing the peer, which would conceal missing stop ownership.
		stack := muxWorkerStack()
		if muxWorkersRunning(stack) || strings.Contains(stack, "reverse.(*PortalWorker).run") || strings.Contains(stack, "reverse.NewStaticMuxPicker.func1") {
			t.Errorf("Portal owned mux workers remain after StopXray:\n%s", stack)
		}
		conn.Close()
		if t.Failed() {
			return
		}
		if err := StopXray(); err != nil {
			t.Fatal(err)
		}
	}
}
