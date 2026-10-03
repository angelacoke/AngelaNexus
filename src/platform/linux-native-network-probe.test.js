import test from "node:test";
import assert from "node:assert/strict";
import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";
import { createLinuxNativeNetworkCommandProbes } from "./linux-native-network-probe.js";

test("command bridge maps one native snapshot to all capability probes", () => {
  let calls = 0;
  const probes = createLinuxNativeNetworkCommandProbes({
    commandPath: "/opt/angelanexus/network-probe",
    spawnSyncImpl: () => {
      calls += 1;
      return { status: 0, stdout: "ipv4=1 ipv6=0 policy-route=-1 nftables=1 policy-rules=6 ipv4-routes=3 ipv6-routes=2 ipv4-default-routes=1 ipv6-default-routes=0 ipv4-route-state=1 ipv6-route-state=0 nft-tables=2 nft-chains=4\n", stderr: "" };
    },
  });

  assert.equal(probes[LinuxCapabilities.IPV4]().state, LinuxCapabilityStates.VERIFIED);
  assert.equal(probes[LinuxCapabilities.IPV6]().state, LinuxCapabilityStates.UNSUPPORTED);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().state, LinuxCapabilityStates.FAILED);
  assert.equal(probes[LinuxCapabilities.NFTABLES]().state, LinuxCapabilityStates.VERIFIED);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.policyRuleCount, 6);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv4RouteCount, 3);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv6RouteCount, 2);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv4DefaultRouteCount, 1);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv6DefaultRouteCount, 0);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv4RouteState, LinuxCapabilityStates.VERIFIED);
  assert.equal(probes[LinuxCapabilities.POLICY_ROUTE]().evidence.ipv6RouteState, LinuxCapabilityStates.UNSUPPORTED);
  assert.equal(probes[LinuxCapabilities.NFTABLES]().evidence.nftTableCount, 2);
  assert.equal(probes[LinuxCapabilities.NFTABLES]().evidence.nftChainCount, 4);
  assert.equal(calls, 1);
});

test("command bridge rejects invalid native output fail-closed", () => {
  const probes = createLinuxNativeNetworkCommandProbes({
    commandPath: "/opt/angelanexus/network-probe",
    spawnSyncImpl: () => ({ status: 0, stdout: "unexpected output\n", stderr: "" }),
  });

  const result = probes[LinuxCapabilities.IPV4]();
  assert.equal(result.state, LinuxCapabilityStates.FAILED);
  assert.equal(result.reason, "native-probe-invalid-output");
});

test("command bridge fails closed on native command failure", () => {
  const probes = createLinuxNativeNetworkCommandProbes({
    commandPath: "/opt/angelanexus/network-probe",
    spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "probe failed" }),
  });

  const result = probes[LinuxCapabilities.NFTABLES]();
  assert.equal(result.state, LinuxCapabilityStates.FAILED);
  assert.equal(result.reason, "native-probe-nonzero-exit");
});

test("command bridge fails closed on spawn exception", () => {
  const probes = createLinuxNativeNetworkCommandProbes({
    commandPath: "/opt/angelanexus/network-probe",
    spawnSyncImpl: () => {
      throw new Error("spawn unavailable");
    },
  });

  const result = probes[LinuxCapabilities.IPV4]();
  assert.equal(result.state, LinuxCapabilityStates.FAILED);
  assert.equal(result.reason, "native-probe-exception");
});
