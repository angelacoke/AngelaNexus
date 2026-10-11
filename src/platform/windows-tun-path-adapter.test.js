import test from "node:test";
import assert from "node:assert/strict";
import { createPathRegistry, PathRegistryStates } from "../core/path-registry.js";
import {
  createWindowsCapabilityRegistry,
  WindowsCapabilities,
  WindowsCapabilityStates,
} from "./windows-capabilities.js";
import { syncWindowsTunPath, WindowsTunStates } from "./windows-tun-path-adapter.js";

function setup() {
  return {
    capabilityRegistry: createWindowsCapabilityRegistry(),
    pathRegistry: createPathRegistry(),
  };
}

function verifiedProbe() {
  return {
    state: WindowsCapabilityStates.VERIFIED,
    reason: null,
    evidence: { tunState: WindowsTunStates.RUNNING, source: "test", checkedAt: 1 },
  };
}

test("missing registries fail without registering a path", () => {
  const { pathRegistry } = setup();
  const noCaps = syncWindowsTunPath({ pathRegistry, probeResult: verifiedProbe() });
  assert.equal(noCaps.ok, false);
  assert.equal(noCaps.reason, "capability-registry-required");

  const { capabilityRegistry } = setup();
  const noPaths = syncWindowsTunPath({ capabilityRegistry, probeResult: verifiedProbe() });
  assert.equal(noPaths.ok, false);
  assert.equal(noPaths.reason, "path-registry-required");
});

test("verified probe with full readiness admits an active path", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncWindowsTunPath({
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
  assert.equal(result.capability.state, WindowsCapabilityStates.VERIFIED);
});

test("unverified probe quarantines the path and blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncWindowsTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: { state: WindowsCapabilityStates.FAILED, reason: "driver-load-failed", evidence: {} },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.QUARANTINED);
  assert.equal(result.capability.state, WindowsCapabilityStates.FAILED);
});

test("missing probe quarantines the path", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncWindowsTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: null,
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.QUARANTINED);
});

test("required elevation without evidence blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncWindowsTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    elevationRequired: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.DISABLED);
  assert.equal(result.path.readiness.elevation, false);
});

test("verified elevation unblocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  capabilityRegistry.set(WindowsCapabilities.ELEVATED_INSTALL, {
    state: WindowsCapabilityStates.VERIFIED,
    evidence: { source: "test", checkedAt: 1 },
  });
  const result = syncWindowsTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: verifiedProbe(),
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
    elevationRequired: true,
  });
  assert.equal(result.admissible, true);
  assert.equal(result.path.readiness.elevation, true);
});

test("required process exclusion without evidence fails closed instead of widening scope", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncWindowsTunPath({
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
  assert.equal(result.path.evidence.processExclusionRequired, true);
});

test("verified process exclusion unblocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  capabilityRegistry.set(WindowsCapabilities.PROCESS_EXCLUSION, {
    state: WindowsCapabilityStates.SUPPORTED,
    evidence: { source: "test", checkedAt: 1 },
  });
  const result = syncWindowsTunPath({
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
  const result = syncWindowsTunPath({
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
