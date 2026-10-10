import test from "node:test";
import assert from "node:assert/strict";
import {
  createMacOSCapabilityRegistry,
  MacOSCapabilities,
  MacOSCapabilityStates,
} from "./macos-capabilities.js";

test("unknown capabilities fail closed", () => {
  const registry = createMacOSCapabilityRegistry();
  assert.equal(registry.get(MacOSCapabilities.PACKET_TUNNEL).state, MacOSCapabilityStates.UNKNOWN);
  assert.equal(registry.canUse(MacOSCapabilities.PACKET_TUNNEL), false);
});

test("verified capability can be used", () => {
  const registry = createMacOSCapabilityRegistry();
  registry.set(MacOSCapabilities.PACKET_TUNNEL, {
    state: MacOSCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1, provider: "NEPacketTunnelProvider" },
  });
  assert.equal(registry.canUse(MacOSCapabilities.PACKET_TUNNEL), true);
});

test("degraded capability is only usable when policy explicitly accepts supported-level operation", () => {
  const registry = createMacOSCapabilityRegistry();
  registry.set(MacOSCapabilities.PF_TRANSPARENT, {
    state: MacOSCapabilityStates.DEGRADED,
    evidence: { source: "test", checkedAt: 1 },
    reason: "pf rules partially applied",
  });
  assert.equal(registry.canUse(MacOSCapabilities.PF_TRANSPARENT), false);
  assert.equal(registry.canUse(MacOSCapabilities.PF_TRANSPARENT, MacOSCapabilityStates.SUPPORTED), true);
});

test("invalid state is rejected", () => {
  const registry = createMacOSCapabilityRegistry();
  assert.throws(
    () => registry.set(MacOSCapabilities.APP_PROXY, { state: "guessed" }),
    /invalid macOS capability state/,
  );
});

test("unknown capability name is rejected", () => {
  const registry = createMacOSCapabilityRegistry();
  assert.throws(
    () => registry.set("wintun-tun", { state: MacOSCapabilityStates.SUPPORTED }),
    /unsupported macOS capability/,
  );
});

test("snapshot carries platform and version", () => {
  const registry = createMacOSCapabilityRegistry();
  const snapshot = registry.snapshot();
  assert.equal(snapshot.platform, "macos");
  assert.equal(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.capabilities));
});
