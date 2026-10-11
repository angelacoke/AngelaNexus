import test from "node:test";
import assert from "node:assert/strict";
import { createPathRegistry, PathRegistryStates } from "../core/path-registry.js";
import {
  createIOSCapabilityRegistry,
  IOSCapabilityStates,
} from "./ios-capabilities.js";
import { syncIOSTunPath, IOSTunStates } from "./ios-tun-path-adapter.js";

function setup() {
  return {
    capabilityRegistry: createIOSCapabilityRegistry(),
    pathRegistry: createPathRegistry(),
  };
}

function verifiedProbe() {
  return {
    state: IOSCapabilityStates.VERIFIED,
    reason: null,
    evidence: { tunState: IOSTunStates.RUNNING, source: "test", checkedAt: 1 },
  };
}

test("missing registries fail without registering a path", () => {
  const { pathRegistry } = setup();
  const noCaps = syncIOSTunPath({ pathRegistry, probeResult: verifiedProbe() });
  assert.equal(noCaps.ok, false);
  assert.equal(noCaps.reason, "capability-registry-required");

  const { capabilityRegistry } = setup();
  const noPaths = syncIOSTunPath({ capabilityRegistry, probeResult: verifiedProbe() });
  assert.equal(noPaths.ok, false);
  assert.equal(noPaths.reason, "path-registry-required");
});

test("verified probe with full readiness admits an active path", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncIOSTunPath({
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
  assert.equal(result.path.platform, "ios");
  assert.equal(result.capability.state, IOSCapabilityStates.VERIFIED);
});

test("unverified probe quarantines the path and blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncIOSTunPath({
    capabilityRegistry,
    pathRegistry,
    probeResult: { state: IOSCapabilityStates.FAILED, reason: "tunnel-start-failed", evidence: {} },
    routeReady: true,
    dnsReady: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.admissible, false);
  assert.equal(result.path.state, PathRegistryStates.QUARANTINED);
});

test("missing probe quarantines the path", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncIOSTunPath({
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

test("explicit user denial blocks admission", () => {
  const { capabilityRegistry, pathRegistry } = setup();
  const result = syncIOSTunPath({
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
