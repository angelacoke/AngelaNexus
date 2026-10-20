package main

import (
	"errors"
	"testing"

	"github.com/metacubex/mihomo/config"
	"github.com/metacubex/mihomo/constant"
	"github.com/metacubex/mihomo/tunnel"
)

// CI copies this file into the pinned upstream module alongside the exact bridge
// (only its android build constraint is removed for the host cgo test). These
// tests exercise actual executor.ApplyConfig/tunnel state, not an Android TUN,
// VpnService, a packet data path, or full-core shutdown.
func TestAndroidBridgeConfigurationPreservesAdmissionState(t *testing.T) {
	constant.SetHomeDir(t.TempDir())
	for _, ready := range []bool{false, true} {
		androidRuntime = androidTunLifecycle{}
		androidRuntime.protected.Store(ready)
		cfg, err := config.Parse([]byte(`{"mode":"rule","log-level":"silent","geo-auto-update":false,"rules":["MATCH,DIRECT"],"dns":{"enable":false},"tun":{"enable":false},"ntp":{"enable":false}}`))
		if err != nil {
			t.Fatal(err)
		}
		applyAndroidConfiguration(cfg)
		if androidRuntime.protected.Load() != ready {
			t.Fatal("configuration changed socket admission")
		}
		if ready && tunnel.Status() != tunnel.Running {
			t.Fatal("active configuration failed to resume the tunnel")
		}
		if !ready && tunnel.Status() != tunnel.Suspend {
			t.Fatal("configuration resumed an unattached/stopped tunnel")
		}
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

type bridgeTestListener struct {
	err error
}

func (l *bridgeTestListener) Close() error {
	if tunnel.Status() != tunnel.Suspend {
		return errors.New("listener closed before tunnel admission was suspended")
	}
	return l.err
}

func TestAndroidBridgeStopSuspendsAndRetainsRetryOwnership(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	failure := errors.New("test close failure")
	listener := &bridgeTestListener{err: failure}
	androidRuntime.listener = listener
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if err := stopTunError(); !errors.Is(err, failure) {
		t.Fatalf("lost close failure: %v", err)
	}
	if androidRuntime.listener != listener || androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed stop lost ownership or left admission open")
	}
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume reopened a failed-stop runtime")
	}
	listener.err = nil
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
	if androidRuntime.listener != nil {
		t.Fatal("retry did not release the listener")
	}
	if err := stopTunError(); err != nil {
		t.Fatal(err)
	}
}

func TestAndroidBridgeInvalidTunStartStaysSuspended(t *testing.T) {
	androidRuntime = androidTunLifecycle{}
	androidRuntime.protected.Store(true)
	tunnel.OnRunning()
	if startTUN(-1, nil, nil, nil) != 0 {
		t.Fatal("invalid TUN descriptor was accepted")
	}
	if androidRuntime.protected.Load() || tunnel.Status() != tunnel.Suspend {
		t.Fatal("failed start left admission open")
	}
	suspend(0)
	if tunnel.Status() != tunnel.Suspend {
		t.Fatal("resume reopened a failed-start runtime")
	}
}
