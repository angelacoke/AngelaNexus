package outbound

import (
	"context"
	"sync"
	"testing"

	"github.com/xtls/xray-core/app/proxyman"
	"github.com/xtls/xray-core/common/serial"
	"github.com/xtls/xray-core/transport"
)

type reverseOwnerHandler struct{ tag string }

func (h *reverseOwnerHandler) Tag() string                             { return h.tag }
func (*reverseOwnerHandler) Start() error                              { return nil }
func (*reverseOwnerHandler) Close() error                              { return nil }
func (*reverseOwnerHandler) Dispatch(context.Context, *transport.Link) {}
func (*reverseOwnerHandler) SenderSettings() *serial.TypedMessage      { return nil }
func (*reverseOwnerHandler) ProxySettings() *serial.TypedMessage       { return nil }
func TestRemoveHandlerIfDoesNotRemoveReplacement(t *testing.T) {
	ctx := context.Background()
	for i := 0; i < 100; i++ {
		m, _ := New(ctx, &proxyman.OutboundConfig{})
		old := &reverseOwnerHandler{tag: "same"}
		replacement := &reverseOwnerHandler{tag: "same"}
		if err := m.AddHandler(ctx, old); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); m.RemoveHandlerIf(ctx, "same", old) }()
		go func() { defer wg.Done(); m.RemoveHandler(ctx, "same"); m.AddHandler(ctx, replacement) }()
		wg.Wait()
		if m.GetHandler("same") != replacement {
			t.Fatal("stale owner removed replacement")
		}
		if err := m.RemoveHandlerIf(ctx, "same", old); err != nil {
			t.Fatal(err)
		}
		if m.GetHandler("same") != replacement {
			t.Fatal("second stale owner removal deleted replacement")
		}
		if err := m.RemoveHandlerIf(ctx, "same", replacement); err != nil {
			t.Fatal(err)
		}
		if m.GetHandler("same") != nil {
			t.Fatal("exact owner was not removed")
		}
	}
}
