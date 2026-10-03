import test from "node:test";
import assert from "node:assert/strict";
import { createLinuxCapabilityRegistry, LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";
import { syncLinuxNetworkCapabilities } from "./linux-network-capability-adapter.js";

test("network capabilities are recorded independently", () => {
  const registry = createLinuxCapabilityRegistry();
  const result = syncLinuxNetworkCapabilities({
    capabilityRegistry: registry,
    probes: {
      [LinuxCapabilities.IPV4]: { state: LinuxCapabilityStates.VERIFIED, evidence: { source: "ipv4-probe" } },
      [LinuxCapabilities.IPV6]: { state: LinuxCapabilityStates.SUPPORTED },
      [LinuxCapabilities.POLICY_ROUTE]: { state: LinuxCapabilityStates.DEGRADED, reason: "policy-route-partial" },
      [LinuxCapabilities.NFTABLES]: { state: LinuxCapabilityStates.FAILED, reason: "nft-probe-failed" },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(registry.get(LinuxCapabilities.IPV4).state, LinuxCapabilityStates.VERIFIED);
  assert.equal(registry.get(LinuxCapabilities.IPV6).state, LinuxCapabilityStates.SUPPORTED);
  assert.equal(registry.get(LinuxCapabilities.POLICY_ROUTE).state, LinuxCapabilityStates.DEGRADED);
  assert.equal(registry.get(LinuxCapabilities.NFTABLES).state, LinuxCapabilityStates.FAILED);
  assert.equal(registry.get(LinuxCapabilities.IPV4).evidence.independentlyProbed, true);
});

test("missing probes fail closed without inventing support", () => {
  const registry = createLinuxCapabilityRegistry();
  const result = syncLinuxNetworkCapabilities({
    capabilityRegistry: registry,
    probes: {},
  });

  assert.equal(result.ok, true);
  for (const capability of [
    LinuxCapabilities.IPV4,
    LinuxCapabilities.IPV6,
    LinuxCapabilities.POLICY_ROUTE,
    LinuxCapabilities.NFTABLES,
  ]) {
    assert.equal(registry.get(capability).state, LinuxCapabilityStates.FAILED);
  }
});

test("probe functions are invoked independently", () => {
  const registry = createLinuxCapabilityRegistry();
  const calls = [];
  syncLinuxNetworkCapabilities({
    capabilityRegistry: registry,
    probes: {
      [LinuxCapabilities.IPV4]: () => { calls.push("ipv4"); return { state: LinuxCapabilityStates.VERIFIED }; },
      [LinuxCapabilities.IPV6]: () => { calls.push("ipv6"); return { state: LinuxCapabilityStates.VERIFIED }; },
      [LinuxCapabilities.POLICY_ROUTE]: () => { calls.push("route"); return { state: LinuxCapabilityStates.VERIFIED }; },
      [LinuxCapabilities.NFTABLES]: () => { calls.push("nftables"); return { state: LinuxCapabilityStates.VERIFIED }; },
    },
  });
  assert.deepEqual(calls, ["ipv4", "ipv6", "policy-route", "nftables"]);
});


test("native probe results map into verified capability evidence", () => {
  const registry = createLinuxCapabilityRegistry();
  const probes = createLinuxNativeNetworkProbes({
    probeIpv4: () => 1,
    probeIpv6: () => 0,
    probePolicyRouting: () => -1,
    probeNftables: () => 1,
  });
  const result = syncLinuxNetworkCapabilities({ capabilityRegistry: registry, probes });
  assert.equal(result.ok, true);
  assert.equal(registry.get(LinuxCapabilities.IPV4).state, LinuxCapabilityStates.VERIFIED);
  assert.equal(registry.get(LinuxCapabilities.IPV6).state, LinuxCapabilityStates.UNSUPPORTED);
  assert.equal(registry.get(LinuxCapabilities.POLICY_ROUTE).state, LinuxCapabilityStates.FAILED);
  assert.equal(registry.get(LinuxCapabilities.NFTABLES).state, LinuxCapabilityStates.VERIFIED);
  assert.equal(registry.get(LinuxCapabilities.IPV4).evidence.rawResult, 1);
});

test("native probe exceptions fail closed", () => {
  const registry = createLinuxCapabilityRegistry();
  const probes = createLinuxNativeNetworkProbes({
    probeIpv4: () => { throw new Error("probe failed"); },
  });
  syncLinuxNetworkCapabilities({ capabilityRegistry: registry, probes });
  assert.equal(registry.get(LinuxCapabilities.IPV4).state, LinuxCapabilityStates.FAILED);
  assert.equal(registry.get(LinuxCapabilities.IPV4).reason, "native-probe-error");
});
