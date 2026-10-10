import test from "node:test";
import assert from "node:assert/strict";
import {
  createWindowsCapabilityRegistry,
  WindowsCapabilities,
  WindowsCapabilityStates,
} from "./windows-capabilities.js";

test("unknown capabilities fail closed", () => {
  const registry = createWindowsCapabilityRegistry();
  assert.equal(registry.get(WindowsCapabilities.WINTUN_TUN).state, WindowsCapabilityStates.UNKNOWN);
  assert.equal(registry.canUse(WindowsCapabilities.WINTUN_TUN), false);
});

test("verified capability can be used", () => {
  const registry = createWindowsCapabilityRegistry();
  registry.set(WindowsCapabilities.WINTUN_TUN, {
    state: WindowsCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1, dllPath: "C:\\Windows\\System32\\wintun.dll" },
  });
  assert.equal(registry.canUse(WindowsCapabilities.WINTUN_TUN), true);
});

test("degraded capability is only usable when policy explicitly accepts supported-level operation", () => {
  const registry = createWindowsCapabilityRegistry();
  registry.set(WindowsCapabilities.WFP, {
    state: WindowsCapabilityStates.DEGRADED,
    evidence: { source: "test", checkedAt: 1 },
    reason: "callout driver unavailable",
  });
  assert.equal(registry.canUse(WindowsCapabilities.WFP), false);
  assert.equal(registry.canUse(WindowsCapabilities.WFP, WindowsCapabilityStates.SUPPORTED), true);
});

test("invalid state is rejected", () => {
  const registry = createWindowsCapabilityRegistry();
  assert.throws(
    () => registry.set(WindowsCapabilities.SYSTEM_PROXY, { state: "guessed" }),
    /invalid Windows capability state/,
  );
});

test("unknown capability name is rejected", () => {
  const registry = createWindowsCapabilityRegistry();
  assert.throws(
    () => registry.set("nftables", { state: WindowsCapabilityStates.SUPPORTED }),
    /unsupported Windows capability/,
  );
});

test("snapshot carries platform and version", () => {
  const registry = createWindowsCapabilityRegistry();
  const snapshot = registry.snapshot();
  assert.equal(snapshot.platform, "windows");
  assert.equal(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.capabilities));
});
