import test from "node:test";
import assert from "node:assert/strict";
import { createNetworkControlPlane } from "../src/platform/network-control-plane.js";
import { DevicePolicyEngine } from "../src/platform/device-policy-engine.js";
import { NetworkLifecycle } from "../src/platform/network-lifecycle.js";

function fixture({ trafficResult = "success", cleanupVerified = true } = {}) {
  const events = [];
  const evidence = [];
  const lifecycle = new NetworkLifecycle({
    evidenceStore: { async record(value) { evidence.push(value); } },
    clock: () => new Date("2026-10-02T00:00:00.000Z"),
  });
  const adapter = {
    async capabilityGate() { events.push("capability"); return { allowed: true }; },
    async prepare(scenario, decision) { events.push("prepare:" + decision.action); return { id: scenario.id }; },
    async apply() { events.push("apply"); return { applied: true }; },
    async liveVerify() { events.push("live"); return { verified: true }; },
    async trafficAcceptance() { events.push("traffic"); return { result: trafficResult }; },
    async rollback() { events.push("rollback"); return { rolledBack: true }; },
    async cleanupVerify() { events.push("cleanup"); return { verified: cleanupVerified }; },
  };
  const controlPlane = createNetworkControlPlane({
    policyEngine: new DevicePolicyEngine({
      policies: [{ id: "app-proxy", matchType: "app", value: "com.example.app", action: "proxy", priority: 10 }],
    }),
    lifecycle,
    kernelAdapter: adapter,
    evidenceStore: { async record(value) { evidence.push(value); } },
    clock: () => new Date("2026-10-02T00:00:00.000Z"),
  });
  return { controlPlane, lifecycle, events, evidence };
}

test("control plane propagates policy decision into kernel execution and reaches running", async () => {
  const f = fixture();
  const result = await f.controlPlane.execute(
    { id: "scenario-001", platform: "android", runtimeMode: "tun", requiredCapabilities: ["tun"] },
    { app: "com.example.app" },
  );
  assert.equal(result.decision.action, "proxy");
  assert.equal(result.acceptance.result, "success");
  assert.equal(f.lifecycle.snapshot().state, "running");
  assert.deepEqual(f.events, ["capability", "prepare:proxy", "apply", "live", "traffic"]);
});

test("control plane fail-closed conflict does not invoke kernel or lifecycle apply", async () => {
  const f = fixture();
  const conflictEngine = new DevicePolicyEngine({
    policies: [
      { id: "a", matchType: "app", value: "com.example.app", action: "proxy", priority: 10 },
      { id: "b", matchType: "app", value: "com.example.app", action: "direct", priority: 10 },
    ],
  });
  const cp = createNetworkControlPlane({
    policyEngine: conflictEngine,
    lifecycle: f.lifecycle,
    kernelAdapter: {
      async capabilityGate() { throw new Error("must not run"); },
      async prepare() {},
      async apply() {},
      async liveVerify() {},
      async trafficAcceptance() {},
      async rollback() {},
      async cleanupVerify() {},
    },
    evidenceStore: { async record(value) { f.evidence.push(value); } },
  });
  const result = await cp.execute({ id: "scenario-002", platform: "android", runtimeMode: "tun", requiredCapabilities: [] }, { app: "com.example.app" });
  assert.equal(result.decision.action, "block");
  assert.equal(result.acceptance.failureClass, "routing-conflict");
  assert.equal(f.lifecycle.snapshot().state, "stopped");
});

test("control plane records degraded state without pretending verified running", async () => {
  const f = fixture({ trafficResult: "degraded" });
  const result = await f.controlPlane.execute({ id: "scenario-003", platform: "android", runtimeMode: "tun", requiredCapabilities: [] }, { app: "com.example.app" });
  assert.equal(result.acceptance.result, "degraded");
  assert.equal(f.lifecycle.snapshot().state, "degraded");
});

test("control plane recovers and restores only after cleanup verification", async () => {
  const f = fixture({ trafficResult: "failure", cleanupVerified: true });
  const result = await f.controlPlane.execute({ id: "scenario-004", platform: "android", runtimeMode: "tun", requiredCapabilities: [] }, { app: "com.example.app" });
  assert.equal(result.acceptance.result, "failure");
  assert.equal(f.lifecycle.snapshot().state, "restored");
  assert.ok(f.events.includes("rollback"));
  assert.ok(f.events.includes("cleanup"));
});
