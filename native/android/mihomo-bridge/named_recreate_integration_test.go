package listener

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	C "github.com/metacubex/mihomo/constant"
	inbound "github.com/metacubex/mihomo/listener/inbound"
)

func TestAngelaNexusNamedMixedPatchRecreatesClosedSameConfig(t *testing.T) {
	name := "angela-recreate"
	mk := func() C.InboundListener {
		l, err := inbound.NewMixed(&inbound.MixedOption{BaseOption: inbound.BaseOption{
			Listen: "127.0.0.1", Port: "0", NameStr: name,
		}})
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	first := mk()
	PatchInboundListeners(map[string]C.InboundListener{name: first}, nil, false)
	if inboundListeners[name] != first {
		t.Fatal("PatchInboundListeners did not install first owner")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := inbound.StopNamedMixed(ctx); err != nil {
		t.Fatal(err)
	}
	second := mk()
	PatchInboundListeners(map[string]C.InboundListener{name: second}, nil, false)
	if inboundListeners[name] != second {
		t.Fatal("closed same-config owner was not replaced")
	}
	if second.(*inbound.Mixed).IsClosed() {
		t.Fatal("replacement still refers to a closed listener")
	}
	peer, err := net.DialTimeout("tcp", second.Address(), time.Second)
	if err != nil {
		t.Fatalf("replacement socket is not listening: %v", err)
	}
	_ = peer.Close()
	if err := inbound.StopNamedMixed(context.Background()); err != nil {
		t.Fatal(err)
	}
	delete(inboundListeners, name)
}

type angelaFakeConfig struct{ name string }

func (c angelaFakeConfig) Name() string { return c.name }
func (c angelaFakeConfig) Equal(other C.InboundConfig) bool {
	o, ok := other.(angelaFakeConfig)
	return ok && c.name == o.name
}

type angelaCloseDebtListener struct {
	cfg   angelaFakeConfig
	close int
}

func (l *angelaCloseDebtListener) Name() string            { return l.cfg.name }
func (l *angelaCloseDebtListener) Config() C.InboundConfig { return l.cfg }
func (l *angelaCloseDebtListener) Address() string         { return "fake" }
func (l *angelaCloseDebtListener) RawAddress() string      { return "fake" }
func (l *angelaCloseDebtListener) Listen(C.Tunnel) error   { return nil }
func (l *angelaCloseDebtListener) Close() error {
	if l.close > 0 {
		l.close--
		return errors.New("injected close debt")
	}
	return nil
}

func TestAngelaNexusNamedPatchRetainsOwnerOnCloseFailure(t *testing.T) {
	name := "angela-close-debt"
	old := &angelaCloseDebtListener{cfg: angelaFakeConfig{name: name}, close: 1}
	newOwner := &angelaCloseDebtListener{cfg: angelaFakeConfig{name: name + "-replacement"}}
	inboundListeners[name] = old
	defer delete(inboundListeners, name)
	PatchInboundListeners(map[string]C.InboundListener{name: newOwner}, nil, false)
	if inboundListeners[name] != old || old.close != 0 {
		t.Fatal("replacement did not attempt and retain failed close owner")
	}
	old.close = 1
	PatchInboundListeners(map[string]C.InboundListener{}, nil, true)
	if inboundListeners[name] != old || old.close != 0 {
		t.Fatal("removal discarded failed close owner")
	}
	PatchInboundListeners(map[string]C.InboundListener{}, nil, true)
	if _, ok := inboundListeners[name]; ok {
		t.Fatal("successful removal retry retained owner")
	}
}
