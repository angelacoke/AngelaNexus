import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionPathTrust,
  ConnectionPathTypes,
  createConnectionPathManager,
} from "./connection-path-manager.js";
import { createPathRegistry } from "../core/path-registry.js";
import { createNetworkEvidenceStore } from "../core/network-evidence.js";
import { createPathReprobeScheduler } from "./path-reprobe-scheduler.js";

function path(id) {
  return {
    id,
    type: ConnectionPathTypes.DIRECT,
    verified: true,
    trust: ConnectionPathTrust.VERIFIED,
    health: "healthy",
    securityHealthy: true,
  };
}

test("connection path manager can evaluate registered paths", () => {
  const registry = createPathRegistry();
  registry.register({ ...path("direct"), type: ConnectionPathTypes.DIRECT });
  registry.register({ ...path("relay"), type: ConnectionPathTypes.RELAY });

  const manager = createConnectionPathManager({
    userPolicy: { preferredOrder: [ConnectionPathTypes.DIRECT, ConnectionPathTypes.RELAY] },
  });
  const result = manager.evaluateRegistry(registry);

  assert.equal(result.ok, true);
  assert.equal(result.selected.id, "direct");
  assert.equal(result.eligible.length, 2);
});

test("registry evaluation remains fail-closed for unsafe paths", () => {
  const registry = createPathRegistry();
  registry.register({ ...path("unsafe"), securityHealthy: false });

  const manager = createConnectionPathManager({ failClosed: true });
  const result = manager.evaluateRegistry(registry);

  assert.equal(result.ok, false);
  assert.equal(result.mode, "fail-closed");
  assert.equal(result.selected, null);
});

test("adaptive evidence selection prefers the measured healthier path", () => {
  const registry = createPathRegistry();
  registry.register(path("slow"));
  registry.register(path("fast"));

  const evidence = createNetworkEvidenceStore({ now: () => 1000 });
  evidence.record({
    id: "slow",
    kind: "path",
    observedAt: 1000,
    confidence: 1,
    metrics: { rttMs: 180, lossRatio: 0.2, retransmissionRatio: 0.1 },
  });
  evidence.record({
    id: "fast",
    kind: "path",
    observedAt: 1000,
    confidence: 1,
    metrics: { rttMs: 20, lossRatio: 0, retransmissionRatio: 0 },
  });

  const manager = createConnectionPathManager({
    userPolicy: {
      evidenceSelection: "adaptive",
      preferredOrder: [ConnectionPathTypes.DIRECT],
    },
  });
  const result = manager.evaluateRegistry(registry, evidence);

  assert.equal(result.selected.id, "fast");
});

test("required evidence prevents unmeasured paths from being selected", () => {
  const registry = createPathRegistry();
  registry.register(path("measured"));
  registry.register(path("unmeasured"));

  const evidence = createNetworkEvidenceStore({ now: () => 1000 });
  evidence.record({
    id: "measured",
    kind: "path",
    observedAt: 1000,
    confidence: 1,
    metrics: { rttMs: 50 },
  });

  const manager = createConnectionPathManager({
    failClosed: true,
    userPolicy: { evidenceMode: "required" },
  });
  const result = manager.evaluateRegistry(registry, evidence);

  assert.equal(result.ok, true);
  assert.equal(result.selected.id, "measured");
  assert.equal(result.eligible.length, 1);
});


test("selected path decisions are identifiable and outcome feedback updates evidence", () => {
  const registry = createPathRegistry();
  registry.register(path("direct"));
  const evidence = createNetworkEvidenceStore({ now: () => 2000 });
  const manager = createConnectionPathManager({ now: () => 2000, userPolicy: { reprobePolicy: "on-failure" } });
  const decision = manager.evaluateRegistry(registry, evidence);
  assert.equal(decision.ok, true);
  assert.match(decision.decisionId, /^path-decision-/);
  const outcome = manager.recordOutcome({ pathId: decision.selected.id, outcome: "failure", evidenceStore: evidence, decisionId: decision.decisionId, metrics: { rttMs: 900, lossRatio: 0.4 } });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reprobeRecommended, true);
  assert.equal(outcome.evidence.attributes.lastOutcome, "failure");
  assert.equal(outcome.evidence.attributes.failureCount, 1);
  assert.equal(outcome.evidence.metrics.sampleCount, 1);
});

test("outcome feedback is policy-bound and supports degraded results", () => {
  const evidence = createNetworkEvidenceStore({ now: () => 3000 });
  const manager = createConnectionPathManager({ now: () => 3000, userPolicy: { reprobePolicy: "disabled" } });
  const outcome = manager.recordOutcome({ pathId: "direct", outcome: "degraded", evidenceStore: evidence, metrics: { rttMs: 300 } });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reprobeRecommended, false);
  assert.equal(outcome.evidence.attributes.lastOutcome, "degraded");
});

test("invalid outcome cannot mutate evidence", () => {
  const evidence = createNetworkEvidenceStore({ now: () => 4000 });
  const manager = createConnectionPathManager({ now: () => 4000 });
  const result = manager.recordOutcome({ pathId: "direct", outcome: "unknown", evidenceStore: evidence });
  assert.equal(result.ok, false);
  assert.equal(evidence.get("direct", "path"), null);
});


test("failure threshold quarantines a path only when user policy enables it", () => {
  const registry = createPathRegistry();
  registry.register({ id: "relay-a", type: "relay", verified: true, securityHealthy: true });
  const evidence = createNetworkEvidenceStore({ now: () => 5000 });
  const manager = createConnectionPathManager({ userPolicy: { recoveryPolicy: "failure-threshold", failureThreshold: 2 }, now: () => 5000 });
  const first = manager.recordOutcome({ pathId: "relay-a", outcome: "failure", evidenceStore: evidence, pathRegistry: registry });
  assert.equal(first.recoveryEligible, false);
  assert.equal(registry.get("relay-a").state, "active");
  const second = manager.recordOutcome({ pathId: "relay-a", outcome: "failure", evidenceStore: evidence, pathRegistry: registry });
  assert.equal(second.recoveryEligible, true);
  assert.equal(second.registryAction, "quarantined");
  assert.equal(registry.get("relay-a").state, "quarantined");
});

test("successful observation can reinstate a quarantined path", () => {
  const registry = createPathRegistry();
  registry.register({ id: "relay-b", type: "relay", state: "quarantined", verified: true, securityHealthy: true });
  const evidence = createNetworkEvidenceStore({ now: () => 6000 });
  const manager = createConnectionPathManager({ userPolicy: { recoveryPolicy: "failure-threshold", failureThreshold: 1 }, now: () => 6000 });
  const result = manager.recordOutcome({ pathId: "relay-b", outcome: "success", evidenceStore: evidence, pathRegistry: registry });
  assert.equal(result.registryAction, "reinstated");
  assert.equal(registry.get("relay-b").state, "active");
});

test("recovery remains disabled by default", () => {
  const registry = createPathRegistry();
  registry.register({ id: "relay-c", type: "relay", verified: true, securityHealthy: true });
  const evidence = createNetworkEvidenceStore({ now: () => 7000 });
  const manager = createConnectionPathManager({ now: () => 7000 });
  const result = manager.recordOutcome({ pathId: "relay-c", outcome: "failure", evidenceStore: evidence, pathRegistry: registry });
  assert.equal(result.recoveryEligible, false);
  assert.equal(registry.get("relay-c").state, "active");
});


test("outcome feedback schedules a bounded re-probe only when the scheduler is enabled", () => {
  const evidence = createNetworkEvidenceStore({ now: () => 8000 });
  const scheduler = createPathReprobeScheduler({
    now: () => 8000,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1000 },
  });
  const manager = createConnectionPathManager({
    now: () => 8000,
    userPolicy: { reprobePolicy: "on-failure" },
  });
  const result = manager.recordOutcome({
    pathId: "direct",
    outcome: "failure",
    evidenceStore: evidence,
    reprobeScheduler: scheduler,
  });
  assert.equal(result.reprobeRecommended, true);
  assert.equal(result.schedulerAction, "scheduled");
  assert.equal(scheduler.get("direct").state, "scheduled");
});
