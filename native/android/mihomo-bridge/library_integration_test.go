package main

import (
	"flag"
	"testing"

	"github.com/metacubex/mihomo/component/dialer"
	"github.com/metacubex/mihomo/tunnel"
)

// A package-level test (rather than an explicit file list) includes every source
// in the same dedicated package used by the native shared-library build.
func TestAndroidBridgeLibraryHasNoCLIFlags(t *testing.T) {
	for _, name := range []string{"d", "f", "config", "ext-ctl", "secret", "post-up", "post-down", "v", "t"} {
		if flag.Lookup(name) != nil {
			t.Errorf("library registered upstream CLI flag %q", name)
		}
	}
}

func TestAndroidBridgeLibraryInstallsFailClosedHook(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	defer stopTunError()
	if dialer.DefaultSocketHook == nil {
		t.Fatal("library did not install socket protection hook")
	}
	raw := &bridgeEpochRawConn{}
	if err := dialer.DefaultSocketHook("tcp", "127.0.0.1:1", raw); err == nil {
		t.Fatal("unattached library admitted a socket")
	}
	if raw.controls != 0 {
		t.Fatal("unattached library touched the raw socket")
	}
	// No host VpnService symbol exists: the real cgo callback must fail closed,
	// even if readiness was otherwise enabled. This is not Android VPN evidence.
	androidRuntime.protected.Store(true)
	if err := dialer.DefaultSocketHook("tcp", "127.0.0.1:1", raw); err == nil {
		t.Fatal("library admitted a socket without VpnService protection")
	}
	if raw.controls != 1 {
		t.Fatalf("expected one raw control callback, got %d", raw.controls)
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("library stop did not suspend tunnel admission")
	}
}
