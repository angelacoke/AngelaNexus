import test from "node:test";
import assert from "node:assert/strict";
import { NetworkAcceptanceHarness } from "./network-acceptance-harness.js";

function harness(overrides = {}) {
  const events = [];
  const evidenceStore = { record: async (e) => events.push(e) };
  const base = {
    capabilityGate: async () => ({ allowed: true, verified: true }),
    prepare: async () => ({ id: "tx-1" }),
    apply: async () => ({ applied: true }),
    liveVerify: async () => ({ verified: true }),
    trafficAcceptance: async () => ({ result: "success" }),
    rollback: async () => ({ requested: true }),
    cleanupVerify: async () => ({ verified: true }),
    evidenceStore,
    clock: () => new Date("2026-10-02T13:00:00.000Z"),
  };
  return { h: new NetworkAcceptanceHarness({ ...base, ...overrides }), events };
}

const scenario = {
  id: "android-root-tcp-ipv4",
  version: "1",
  platform: "android",
  runtimeMode: "root-transparent",
  requiredCapabilities: ["root", "tcp", "ipv4", "policy-routing"],
};

test("acceptance requires user and security gates before prepare", async () => {
  const { h, events } = harness();
  const denied = await h.run(scenario, { userAllowed: false });
  assert.equal(denied.result, "rejected");
  assert.equal(denied.failureClass, "user-denied");
  assert.equal(events.length, 1);
});

test("acceptance rejects unverified capability without applying", async () => {
  let prepared = false;
  const { h } = harness({
    capabilityGate: async () => ({ allowed: false, verified: false }),
    prepare: async () => { prepared = true; return {}; },
  });
  const result = await h.run(scenario);
  assert.equal(result.failureClass, "capability-unavailable");
  assert.equal(prepared, false);
});

test("successful live traffic becomes verified evidence", async () => {
  const { h, events } = harness();
  const result = await h.run(scenario);
  assert.equal(result.result, "success");
  assert.equal(result.verificationState, "verified");
  assert.equal(events[0].scenarioId, scenario.id);
});

test("traffic failure requires rollback and cleanup verification", async () => {
  let rolledBack = false;
  let cleaned = false;
  const { h } = harness({
    trafficAcceptance: async () => ({ result: "failure", failureClass: "traffic-failed" }),
    rollback: async () => { rolledBack = true; return { requested: true }; },
    cleanupVerify: async () => { cleaned = true; return { verified: true }; },
  });
  const result = await h.run(scenario);
  assert.equal(result.result, "failure");
  assert.equal(result.failureClass, "traffic-failed");
  assert.equal(rolledBack, true);
  assert.equal(cleaned, true);
});

test("cleanup failure dominates rollback outcome", async () => {
  const { h } = harness({
    liveVerify: async () => ({ verified: false, failureClass: "verification-failed" }),
    cleanupVerify: async () => ({ verified: false, failureClass: "cleanup-failed" }),
  });
  const result = await h.run(scenario);
  assert.equal(result.result, "failure");
  assert.equal(result.failureClass, "cleanup-failed");
  assert.equal(result.verificationState, "failed");
});
