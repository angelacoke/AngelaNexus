import test from "node:test";
import assert from "node:assert/strict";
import { createPathRegistry, PathRegistryStates } from "../core/path-registry.js";
import {
  createMacOSCapabilityRegistry,
  MacOSCapabilities,
  MacOSCapabilityStates,
} from "./macos-capabilities.js";
import { syncMacOSTunPath, MacOSTunStates } from "./macos-tun-path-adapter.js";

function setup() {
  return {
    capabilityRegistry: createMacOSCapabilityRegistry(),
    pathRegistry: createPathRegistry(),
  };
}

function verifiedProbe() {
  return {
    state: MacOSCapabilityStates.VERIFIED,
    reason: null,
    evidence: { tunState: MacOSTunStates.RUNNING, source: "test", checkedAt: 1 },
  };
}

test("missing registries fail without registering a path", () => {
  const { pathRegistry } = setup();
  const noCaps = syncMacOSTunPath({ pathRegistry, probeResult: verifiedProbe() });
  assert.equal(noCaps.ok, false);
  assert.equal(noCaps.reason, "capability-registry-required");

  const { capabilityRegistry } = setup();
  const noPaths = syncMacOSTunPath({ capabilityRegistry, probeResult: verifiedProbe() });
  assert.equal(noPaths.ok, false);
  assert.equal(noPaths.reason, "path-registry-required");
});

test("verified probe with full readiness admits an active path", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncMacOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, true);
  assert.equal(result.path.state, PathRegistryStates.ACTIVE);
  assert.equal(result.path.platform, "macos");
  assert.equal(result.capability.state, MacOSCapabilityStates.VERIFIED);
});

test("unverified probe quarantines the path and blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncMacOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: { state: MacOSCapabilityStates.FAILED, reason: "tunnel-start-failed", evidence: {} },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.QUARANTINED);
});

test("required process exclusion without evidence fails closed instead of widening scope", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncMacOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    processExclusionRequired: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.DISABLED);
  assert.equal(result.path.readiness.processExclusion, false);
});

test("verified process exclusion unblocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  capabilityRegistry.set(MacOSCapabilities.PROCESS_EXCLUSION, {
    state: MacOSCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1 },
  });
  const result = syncMacOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    processExclusionRequired: true,
  });
  assert.equal(result.admissible, true);
  assert.equal(result.path.state, PathRegistryStates.ACTIVE);
});

test("explicit user denial blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncMacOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    userAllowed: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.userAllowed, false);
});
