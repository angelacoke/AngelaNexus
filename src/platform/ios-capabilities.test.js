import test from "node:test";
import assert from "node:assert/strict";
import {
  createIOSCapabilityRegistry,
  IOSCapabilities,
  IOSCapabilityStates,
  IOS_PLATFORM_CONSTRAINTS,
} from "./ios-capabilities.js";

test("unknown capabilities fail closed", () => {
  const registry = createIOSCapabilityRegistry();
  assert.equal(registry.get(IOSCapabilities.PACKET_TUNNEL).state, IOSCapabilityStates.UNKNOWN);
  assert.equal(registry.canUse(IOSCapabilities.PACKET_TUNNEL), false);
});

test("verified capability can be used", () => {
  const registry = createIOSCapabilityRegistry();
  registry.set(IOSCapabilities.PACKET_TUNNEL, {
    state: IOSCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1, provider: "NEPacketTunnelProvider" },
  });
  assert.equal(registry.canUse(IOSCapabilities.PACKET_TUNNEL), true);
});

test("degraded capability is only usable when policy explicitly accepts supported-level operation", () => {
  const registry = createIOSCapabilityRegistry();
  registry.set(IOSCapabilities.APP_PROXY, {
    state: IOSCapabilityStates.DEGRADED,
    evidence: { source: "test", checkedAt: 1 },
    reason: "supervised-device profile missing",
  });
  assert.equal(registry.canUse(IOSCapabilities.APP_PROXY), false);
  assert.equal(registry.canUse(IOSCapabilities.APP_PROXY, IOSCapabilityStates.SUPPORTED), true);
});

test("invalid state is rejected", () => {
  const registry = createIOSCapabilityRegistry();
  assert.throws(
    () => registry.set(IOSCapabilities.DNS_OBSERVATION, { state: "guessed" }),
    /invalid iOS capability state/,
  );
});

test("unknown capability name is rejected", () => {
  const registry = createIOSCapabilityRegistry();
  assert.throws(
    () => registry.set("wintun-tun", { state: IOSCapabilityStates.SUPPORTED }),
    /unsupported iOS capability/,
  );
});

test("platform constraints are documented without claiming probed states", () => {
  assert.equal(IOS_PLATFORM_CONSTRAINTS.noRootAssumption, true);
  assert.equal(IOS_PLATFORM_CONSTRAINTS.noPrivilegedTransparentProxyOutsideNetworkExtension, true);
  assert.equal(IOS_PLATFORM_CONSTRAINTS.defaultRouteRequiresExplicitUserPolicy, true);
  const registry = createIOSCapabilityRegistry();
  assert.equal(registry.get(IOSCapabilities.PACKET_TUNNEL).state, IOSCapabilityStates.UNKNOWN);
});

test("snapshot carries platform and version", () => {
  const registry = createIOSCapabilityRegistry();
  const snapshot = registry.snapshot();
  assert.equal(snapshot.platform, "ios");
  assert.equal(snapshot.version, 1);
  assert.ok(Array.isArray(snapshot.capabilities));
});
