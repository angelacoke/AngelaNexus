package sniffer

import (
	"net"
	"net/netip"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
)

type quicTestSender struct{}

func (quicTestSender) Send(C.PacketAdapter)                       {}
func (quicTestSender) Process(C.PacketConn, C.WriteBackProxy)     {}
func (quicTestSender) Close()                                     {}
func (quicTestSender) DoSniff(*C.Metadata) error                  { return nil }
func (quicTestSender) AddMapping(*C.Metadata, *C.Metadata)        {}
func (quicTestSender) RestoreReadFrom(addr netip.Addr) netip.Addr { return addr }
func (quicTestSender) WriteBack([]byte, net.Addr) (int, error)    { return 0, nil }
func (quicTestSender) UpdateWriteBack(C.WriteBack)                {}

func TestAngelaNexusQUICSenderDoSniffCallbackCanReenterClose(t *testing.T) {
	q := &quicPacketSender{PacketSender: quicTestSender{}, done: make(chan struct{}), buffer: make([]byte, 32)}
	q.close()
	callbackCalls := 0
	q.replaceDomain = func(metadata *C.Metadata, host string) {
		callbackCalls++
		metadata.Host = host
		q.Close()
	}
	q.result = "example.com"

	metadata := &C.Metadata{}
	finished := make(chan error, 1)
	go func() { finished <- q.DoSniff(metadata) }()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("DoSniff deadlocked while replaceDomain re-entered Close")
	}
	if callbackCalls != 1 || metadata.Host != "example.com" {
		t.Fatalf("sniff result callback lost: calls=%d host=%q", callbackCalls, metadata.Host)
	}
	if q.buffer != nil {
		t.Fatal("Close did not release the sniff buffer")
	}
}
