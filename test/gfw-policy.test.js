import test from "node:test";
import assert from "node:assert/strict";
import {
  GfwSignals,
  GfwStates,
  createGfwPolicy,
  validateGfwPolicy,
  classifyGfwEvidence,
  recommendGfwResilience
} from "../src/core/gfw-policy.js";

test("GFW resilience is enabled by default without claiming censorship from one failure", () => {
  const policy = createGfwPolicy();
  assert.equal(policy.enabled, true);
  const result = classifyGfwEvidence([{ signal: GfwSignals.TCP_RESET }], { now: 100000 });
  assert.equal(result.state, GfwStates.SUSPECTED);
  assert.equal(result.evidenceCount, 1);
});

test("independent DNS and QUIC evidence can reach confirmed state", () => {
  const result = classifyGfwEvidence([
    { signal: GfwSignals.DNS_INJECTION, count: 1, independent: true },
    { signal: GfwSignals.QUIC_INITIAL_FAILURE, count: 1, independent: true }
  ], { now: 100000 });
  assert.equal(result.state, GfwStates.CONFIRMED);
  assert.ok(result.score >= 4);
  assert.ok(result.actions.includes("secure-dns"));
  assert.ok(result.actions.includes("avoid-affected-transport"));
});

test("duplicate observations from the same source do not create artificial evidence", () => {
  const result = classifyGfwEvidence([
    { signal: GfwSignals.DNS_INJECTION, count: 20, independent: false },
    { signal: GfwSignals.TCP_RESET, count: 1, independent: true }
  ], { now: 100000 });
  assert.equal(result.evidenceCount, 1);
  assert.equal(result.state, GfwStates.SUSPECTED);
});

test("stale observations are ignored", () => {
  const result = classifyGfwEvidence([
    { signal: GfwSignals.DNS_INJECTION, count: 3, at: 1 }
  ], { now: 100000, maxObservationAgeMs: 1000 });
  assert.equal(result.state, GfwStates.NORMAL);
  assert.equal(result.evidenceCount, 0);
});

test("strict mode requires fail-closed behavior", () => {
  const result = validateGfwPolicy({ mode: "strict", failClosed: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "GFW_STRICT_REQUIRES_FAIL_CLOSED");
});

test("active probing evidence requires explicit user choice", () => {
  const evidence = classifyGfwEvidence([
    { signal: GfwSignals.ACTIVE_PROBE_SUSPECTED, count: 1 },
    { signal: GfwSignals.TCP_RESET, count: 1 }
  ], { now: 100000 });
  const recommendation = recommendGfwResilience(evidence, {
    availableCapabilities: ["tls", "quic"]
  });
  assert.equal(recommendation.requiresUserChoice, true);
  assert.ok(recommendation.recommendations.some((item) => item.action === "require-user-choice"));
});

test("confirmed QUIC evidence only recommends avoiding the affected transport", () => {
  const evidence = classifyGfwEvidence([
    { signal: GfwSignals.QUIC_INITIAL_FAILURE, count: 2 }
  ], { now: 100000 });
  const recommendation = recommendGfwResilience(evidence, {
    availableCapabilities: ["quic", "tls"]
  });
  assert.equal(recommendation.requiresUserChoice, false);
  assert.ok(recommendation.recommendations.some((item) => item.transport === "quic"));
  assert.ok(!recommendation.recommendations.some((item) => item.action === "require-user-choice"));
});
