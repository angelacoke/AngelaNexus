import test from "node:test";
import assert from "node:assert/strict";
import {
  PathTrustActions,
  PathTrustSignals,
  PathTrustStates,
  createPathTrustPolicy,
  validatePathTrustPolicy,
  evaluatePathTrust,
  createPathTrustSession
} from "../src/core/path-trust.js";

const base = {
  networkId: "net-1",
  networkGeneration: 7,
  routeId: "route-1",
  dnsPathId: "dns-1",
  destinationId: "dest-1",
  transport: "tls",
  certificateId: "cert-1",
  bootstrapId: "boot-1"
};

test("path trust accepts an unchanged fully validated path", () => {
  const result = evaluatePathTrust({ expected: base, observed: base });
  assert.equal(result.state, PathTrustStates.TRUSTED);
  assert.equal(result.action, PathTrustActions.ACCEPT);
  assert.equal(result.trusted, true);
  assert.deepEqual(result.signals, []);
});

test("network generation changes require revalidation and fail closed", () => {
  const result = evaluatePathTrust({
    expected: base,
    observed: { ...base, networkGeneration: 8 }
  });
  assert.equal(result.state, PathTrustStates.UNTRUSTED);
  assert.equal(result.action, PathTrustActions.FAIL_CLOSED);
  assert.ok(result.signals.includes(PathTrustSignals.NETWORK_CHANGED));
});

test("route and DNS path mismatches cannot silently preserve trust", () => {
  const result = evaluatePathTrust({
    expected: base,
    observed: {
      ...base,
      routeId: "route-2",
      dnsPathId: "dns-2"
    }
  });
  assert.equal(result.trusted, false);
  assert.ok(result.signals.includes(PathTrustSignals.ROUTE_CHANGED));
  assert.ok(result.signals.includes(PathTrustSignals.DNS_PATH_CHANGED));
});

test("integrity failures are treated as untrusted", () => {
  const result = evaluatePathTrust({
    expected: base,
    observed: {
      ...base,
      certificateTrusted: false,
      bootstrapTrusted: false
    }
  });
  assert.equal(result.state, PathTrustStates.UNTRUSTED);
  assert.equal(result.action, PathTrustActions.FAIL_CLOSED);
  assert.ok(result.signals.includes(PathTrustSignals.CERTIFICATE_INTEGRITY_FAILURE));
  assert.ok(result.signals.includes(PathTrustSignals.BOOTSTRAP_INTEGRITY_FAILURE));
});

test("prior-path changes are detected even when the configured target is unchanged", () => {
  const result = evaluatePathTrust({
    expected: base,
    previous: base,
    observed: { ...base, routeId: "route-2" }
  });
  assert.equal(result.trusted, false);
  assert.ok(result.signals.includes(PathTrustSignals.ROUTE_CHANGED));
});

test("policy validation rejects non-fail-closed operation", () => {
  const result = validatePathTrustPolicy({ failClosed: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "PATH_TRUST_FAIL_CLOSED_REQUIRED");
});

test("session establishes trust and invalidates on route change", () => {
  const session = createPathTrustSession({ expected: base });
  const established = session.establish(base);
  assert.equal(established.trusted, true);
  assert.equal(session.snapshot().invalidated, false);

  const events = [];
  const unsubscribe = session.subscribeInvalidation(event => events.push(event));
  const result = session.validate({ ...base, routeId: "route-2" });
  assert.equal(result.trusted, false);
  assert.equal(session.snapshot().invalidated, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "route-identity-mismatch");
  assert.ok(events[0].signals.includes(PathTrustSignals.ROUTE_CHANGED));
  unsubscribe();
});

test("explicit invalidation is fail closed and does not mutate expected identity", () => {
  const session = createPathTrustSession({ expected: base });
  session.establish(base);
  const result = session.invalidate("network-generation-changed");
  assert.equal(result.trusted, false);
  assert.equal(result.action, PathTrustActions.FAIL_CLOSED);
  assert.equal(session.snapshot().expected.routeId, "route-1");
  assert.equal(session.snapshot().invalidated, true);
});
