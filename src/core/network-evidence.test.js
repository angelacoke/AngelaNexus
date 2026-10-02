import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkEvidenceKinds,
  createNetworkEvidenceStore,
} from "./network-evidence.js";

test("network evidence is bounded, typed, and queryable", () => {
  let clock = 1000;
  const store = createNetworkEvidenceStore({ maxEntries: 2, ttlMs: 100, now: () => clock });

  assert.equal(store.record({
    id: "path-a",
    kind: NetworkEvidenceKinds.PATH,
    source: "probe",
    confidence: 1.2,
    observedAt: clock,
    metrics: { rttMs: 42, unknown: 9 },
  }).ok, true);

  assert.equal(store.record({
    id: "dns-a",
    kind: NetworkEvidenceKinds.DNS,
    source: "resolver",
    observedAt: clock,
    metrics: { dnsLatencyMs: 12 },
  }).ok, true);

  assert.equal(store.snapshot().size, 2);
  assert.equal(store.get("path-a", NetworkEvidenceKinds.PATH).metrics.rttMs, 42);
  assert.equal(store.get("path-a", NetworkEvidenceKinds.PATH).confidence, 1);
  assert.equal(store.list(NetworkEvidenceKinds.DNS).length, 1);
});

test("expired evidence is removed before use", () => {
  let clock = 1000;
  const store = createNetworkEvidenceStore({ ttlMs: 50, now: () => clock });

  assert.equal(store.record({
    id: "flow-a",
    kind: NetworkEvidenceKinds.FLOW,
    observedAt: clock,
  }).ok, true);

  clock = 1051;
  assert.equal(store.get("flow-a", NetworkEvidenceKinds.FLOW), null);
  assert.equal(store.snapshot().size, 0);
});

test("invalid evidence never enters the store", () => {
  const store = createNetworkEvidenceStore();
  assert.equal(store.record({ id: "", kind: NetworkEvidenceKinds.PATH }).ok, false);
  assert.equal(store.record({ id: "x", kind: "unknown" }).ok, false);
  assert.equal(store.snapshot().size, 0);
});
