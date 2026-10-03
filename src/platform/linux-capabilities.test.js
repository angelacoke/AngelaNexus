import test from "node:test";
import assert from "node:assert/strict";
import {
  createLinuxCapabilityRegistry,
  LinuxCapabilities,
  LinuxCapabilityStates,
} from "./linux-capabilities.js";

test("unknown capabilities fail closed", () => {
  const registry = createLinuxCapabilityRegistry();
  assert.equal(registry.get(LinuxCapabilities.TUN).state, LinuxCapabilityStates.UNKNOWN);
  assert.equal(registry.canUse(LinuxCapabilities.TUN), false);
});

test("verified capability can be used", () => {
  const registry = createLinuxCapabilityRegistry();
  registry.set(LinuxCapabilities.TUN, {
    state: LinuxCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1, device: "/dev/net/tun" },
  });
  assert.equal(registry.canUse(LinuxCapabilities.TUN), true);
});

test("degraded capability is only usable when policy explicitly accepts supported-level operation", () => {
  const registry = createLinuxCapabilityRegistry();
  registry.set(LinuxCapabilities.EBPF, {
    state: LinuxCapabilityStates.DEGRADED,
    evidence: { source: "test", checkedAt: 1 },
    reason: "optional kernel feature unavailable",
  });
  assert.equal(registry.canUse(LinuxCapabilities.EBPF), false);
  assert.equal(registry.canUse(LinuxCapabilities.EBPF, LinuxCapabilityStates.SUPPORTED), true);
});

test("invalid state is rejected", () => {
  const registry = createLinuxCapabilityRegistry();
  assert.throws(
    () => registry.set(LinuxCapabilities.NFTABLES, { state: "guessed" }),
    /invalid Linux capability state/,
  );
});
