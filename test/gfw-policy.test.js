import test from "node:test";
import assert from "node:assert/strict";
import {
  GfwSignals,
  GfwStates,
  createGfwPolicy,
  validateGfwPolicy,
  classifyGfwEvidence,
  recommendGfwResilience,
  createGfwRuntime
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


test("real-time runtime confirms only when independent signals corroborate", () => {
  const runtime = createGfwRuntime({ confirmationDiversity: 2 });
  let result = runtime.observe({ signal: GfwSignals.TCP_RESET, transport: "tcp" }, 100000);
  assert.equal(result.state, GfwStates.SUSPECTED);
  result = runtime.observe({ signal: GfwSignals.TLS_SNI_FAILURE, transport: "tls" }, 100100);
  assert.equal(result.state, GfwStates.CONFIRMED);
  assert.ok(result.corroborated);
  assert.ok(result.actions.includes("fail-closed"));
});

test("real-time runtime decays evidence and recovers after a quiet period", () => {
  const runtime = createGfwRuntime({
    confirmationDiversity: 2,
    decayHalfLifeMs: 1000,
    recoveryQuietPeriodMs: 2000,
    maxObservationAgeMs: 10000
  });
  runtime.observe({ signal: GfwSignals.TCP_RESET }, 100000);
  runtime.observe({ signal: GfwSignals.TLS_SNI_FAILURE }, 100100);
  assert.equal(runtime.snapshot(100100).state, GfwStates.CONFIRMED);
  assert.equal(runtime.snapshot(105000).state, GfwStates.NORMAL);
});

test("real-time runtime detects clock rollback without silently downgrading security", () => {
  const runtime = createGfwRuntime();
  runtime.observe({ signal: GfwSignals.TCP_RESET }, 100000);
  const result = runtime.snapshot(99000);
  assert.equal(result.clockRollback, true);
  assert.equal(result.state, GfwStates.SUSPECTED);
  assert.ok(result.actions.includes("require-path-revalidation"));
});

test("real-time runtime stays bounded and ignores non-independent observations", () => {
  const runtime = createGfwRuntime({ maxObservations: 2 });
  runtime.observe({ signal: GfwSignals.DNS_INJECTION, independent: false }, 100000);
  runtime.observe({ signal: GfwSignals.TCP_RESET }, 100001);
  runtime.observe({ signal: GfwSignals.TLS_SNI_FAILURE }, 100002);
  runtime.observe({ signal: GfwSignals.QUIC_INITIAL_FAILURE }, 100003);
  assert.equal(runtime.size(), 2);
});
