import test from "node:test";
import assert from "node:assert/strict";
import {
  UiRuntimeStates,
  UI_RUNTIME_LABEL_KEYS,
  createRuntimeViewModel,
  toUiRuntimeState
} from "../src/ui/semantic-state.js";

test("UI runtime states preserve the Core lifecycle vocabulary", () => {
  assert.deepEqual(Object.values(UiRuntimeStates), [
    "idle",
    "preparing",
    "validating",
    "starting",
    "running",
    "degraded",
    "recovering",
    "stopped",
    "failed"
  ]);
});

test("UI runtime states expose translation keys instead of hardcoded presentation text", () => {
  assert.deepEqual(Object.keys(UI_RUNTIME_LABEL_KEYS), Object.values(UiRuntimeStates));
  assert.equal(toUiRuntimeState("running").labelKey, "runtime.running");
  assert.equal(toUiRuntimeState("failed").labelKey, "runtime.failed");
});

test("only active Core execution states permit a proxy-active UI claim", () => {
  for (const state of ["idle", "preparing", "validating", "starting", "recovering", "stopped", "failed"]) {
    assert.equal(toUiRuntimeState(state).proxyClaimAllowed, false);
  }

  assert.equal(toUiRuntimeState("running").proxyClaimAllowed, true);
  assert.equal(toUiRuntimeState("degraded").proxyClaimAllowed, true);
});

test("UI projection does not infer VPN, routing, DNS, anti-leak, GFW or sync state", () => {
  const model = createRuntimeViewModel({
    experienceState: "running",
    vpnState: "inactive",
    routeState: "direct",
    dnsState: "unknown",
    antiLeakState: "checking",
    gfwState: "observing",
    syncState: "idle"
  });

  assert.equal(model.runtime.proxyClaimAllowed, true);
  assert.equal(model.runtime.labelKey, "runtime.running");
  assert.equal(model.vpnState, "inactive");
  assert.equal(model.routeState, "direct");
  assert.equal(model.dnsState, "unknown");
  assert.equal(model.antiLeakState, "checking");
  assert.equal(model.gfwState, "observing");
  assert.equal(model.syncState, "idle");
});

test("unsupported runtime states are rejected instead of silently mapped", () => {
  assert.throws(
    () => toUiRuntimeState("connected"),
    /unsupported runtime state/
  );
});
