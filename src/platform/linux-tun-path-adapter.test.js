import test from "node:test";
import assert from "node:assert/strict";
import { createLinuxCapabilityRegistry, LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";
import { LinuxTunStates } from "./linux-tun-probe.js";
import { createPathRegistry, PathRegistryStates } from "../core/path-registry.js";
import { syncLinuxTunPath } from "./linux-tun-path-adapter.js";

test("verified TUN remains non-admissible until route and DNS readiness are independently verified", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: {
      state: LinuxCapabilityStates.VERIFIED,
      evidence: { tunState: LinuxTunStates.RUNNING, interface: "angelanexus0" },
    },
    routeReady: false,
    dnsReady: false,
    securityHealthy: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(capabilities.get(LinuxCapabilities.TUN).state, LinuxCapabilityStates.VERIFIED);
  assert.equal(paths.get("linux-tun").state, PathRegistryStates.DISABLED);
  assert.equal(paths.get("linux-tun").readiness.route, false);
  assert.equal(paths.get("linux-tun").readiness.dns, false);
});

test("fully verified TUN path becomes active and admissible", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: {
      state: LinuxCapabilityStates.VERIFIED,
      evidence: { tunState: LinuxTunStates.UP },
    },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });

  assert.equal(result.admissible, true);
  assert.equal(paths.get("linux-tun").state, PathRegistryStates.ACTIVE);
  assert.equal(paths.get("linux-tun").securityHealthy, true);
});

test("failed TUN probe is quarantined and cannot be admitted", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: { state: LinuxCapabilityStates.FAILED, reason: "tun-state-probe-failed" },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });

  assert.equal(result.admissible, false);
  assert.equal(capabilities.get(LinuxCapabilities.TUN).state, LinuxCapabilityStates.FAILED);
  assert.equal(paths.get("linux-tun").state, PathRegistryStates.QUARANTINED);
  assert.equal(paths.get("linux-tun").verified, false);
});

test("user disallow remains authoritative", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: {
      state: LinuxCapabilityStates.VERIFIED,
      evidence: { tunState: LinuxTunStates.RUNNING },
    },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    userAllowed: false,
  });

  assert.equal(result.admissible, false);
  assert.equal(paths.get("linux-tun").userAllowed, false);
});


test("verified network state evidence can establish route and firewall readiness without asserting security health", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: {
      state: LinuxCapabilityStates.VERIFIED,
      evidence: { tunState: LinuxTunStates.RUNNING },
    },
    routeReady: false,
    dnsReady: true,
    securityHealthy: false,
    networkEvidence: {
      policyRouting: {
        state: LinuxCapabilityStates.VERIFIED,
        ruleCount: 6,
      },
      nftables: {
        state: LinuxCapabilityStates.VERIFIED,
        tableCount: 2,
        chainCount: 4,
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(paths.get("linux-tun").readiness.route, true);
  assert.equal(paths.get("linux-tun").readiness.firewall, true);
  assert.equal(paths.get("linux-tun").securityHealthy, false);
  assert.equal(paths.get("linux-tun").state, PathRegistryStates.DISABLED);
  assert.equal(paths.get("linux-tun").evidence.networkState.policyRuleCount, 6);
});

test("network evidence with zero policy rules or nftables objects does not create readiness", () => {
  const capabilities = createLinuxCapabilityRegistry();
  const paths = createPathRegistry();

  const result = syncLinuxTunPath({
    capabilityRegistry: capabilities,
    pathRegistry: paths,
    probeResult: {
      state: LinuxCapabilityStates.VERIFIED,
      evidence: { tunState: LinuxTunStates.RUNNING },
    },
    routeReady: false,
    dnsReady: true,
    securityHealthy: false,
    networkEvidence: {
      policyRouting: { state: LinuxCapabilityStates.VERIFIED, ruleCount: 0 },
      nftables: { state: LinuxCapabilityStates.VERIFIED, tableCount: 0, chainCount: 0 },
    },
  });

  assert.equal(result.admissible, false);
  assert.equal(paths.get("linux-tun").readiness.route, false);
  assert.equal(paths.get("linux-tun").readiness.firewall, false);
});
