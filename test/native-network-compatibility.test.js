import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkCompatibilityActions,
  createNativeNetworkCompatibilityPolicy,
  validateNativeNetworkCompatibilityPolicy,
  evaluateNativeNetworkConsistency,
  createNativeNetworkSessionState
} from "../src/core/native-network-compatibility.js";

test("native compatibility policy is fail-closed and never adds direct fallback", () => {
  const policy = createNativeNetworkCompatibilityPolicy();
  assert.equal(policy.failClosed, true);
  assert.equal(policy.directFallback, false);
  assert.equal(policy.deviceIdentitySpoofing, false);
  assert.equal(policy.preserveIpv4Ipv6Semantics, true);
  assert.equal(policy.requireRouteConsistency, true);
  assert.equal(policy.requireDnsPathConsistency, true);
  assert.equal(validateNativeNetworkCompatibilityPolicy(policy).ok, true);
});

test("healthy route, DNS path, and address family are accepted", () => {
  const result = evaluateNativeNetworkConsistency({
    destination: { ipVersion: 4, routeId: "trusted-path", dnsPathId: "secure-dns" },
    routeId: "trusted-path",
    dnsPathId: "secure-dns",
    dnsAddress: { ipVersion: 4 }
  });

  assert.equal(result.allowed, true);
  assert.equal(result.action, NetworkCompatibilityActions.ACCEPT);
  assert.deepEqual(result.reasons, []);
});

test("route mismatch fails closed instead of falling back to direct", () => {
  const result = evaluateNativeNetworkConsistency({
    destination: { ipVersion: 4, routeId: "trusted-path", dnsPathId: "secure-dns" },
    routeId: "unexpected-path",
    dnsPathId: "secure-dns",
    dnsAddress: { ipVersion: 4 }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, NetworkCompatibilityActions.FAIL_CLOSED);
  assert.ok(result.reasons.includes("route-mismatch"));
});

test("DNS path mismatch is rejected to prevent split-path behavior", () => {
  const result = evaluateNativeNetworkConsistency({
    destination: { ipVersion: 6, routeId: "trusted-path", dnsPathId: "secure-dns" },
    routeId: "trusted-path",
    dnsPathId: "other-dns",
    dnsAddress: { ipVersion: 6 }
  });

  assert.equal(result.allowed, false);
  assert.equal(result.action, NetworkCompatibilityActions.FAIL_CLOSED);
  assert.ok(result.reasons.includes("dns-path-mismatch"));
});

test("IPv6 remains available when policy allows it", () => {
  const result = evaluateNativeNetworkConsistency({
    destination: { ipVersion: 6, routeId: "trusted-path", dnsPathId: "secure-dns" },
    routeId: "trusted-path",
    dnsPathId: "secure-dns",
    dnsAddress: { ipVersion: 6 }
  }, { allowIpv6: true });

  assert.equal(result.allowed, true);
});

test("network session changes require explicit revalidation", () => {
  const state = createNativeNetworkSessionState({
    networkId: "wifi-1",
    generation: 7
  });

  assert.equal(state.networkId, "wifi-1");
  assert.equal(state.generation, 7);
  assert.equal(state.requiresRevalidation, true);
  assert.equal(state.directFallback, false);
  assert.equal(state.failClosed, true);
});
