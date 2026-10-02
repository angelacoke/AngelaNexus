import test from "node:test";
import assert from "node:assert/strict";
import { createPathReprobeRuntime } from "./path-reprobe-runtime.js";
import { createPathReprobeScheduler } from "./path-reprobe-scheduler.js";
import { createConnectionPathManager } from "./connection-path-manager.js";
import { createPathRegistry } from "../core/path-registry.js";
import { createNetworkEvidenceStore } from "../core/network-evidence.js";

function setup(probeResult = "success") {
  let now = 1_000_000;
  const scheduler = createPathReprobeScheduler({
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1, minIntervalMs: 1 },
    now: () => now,
  });
  const pathRegistry = createPathRegistry({ now: () => now });
  pathRegistry.register({
    id: "p1",
    type: "direct",
    state: "active",
    verified: true,
    securityHealthy: true,
    userAllowed: true,
    trust: "verified",
    health: "healthy",
  });
  const evidenceStore = createNetworkEvidenceStore({ now: () => now });
  const pathManager = createConnectionPathManager({
    userPolicy: { reprobePolicy: "disabled" },
    now: () => now,
  });
  const executor = {
    async execute() {
      return { ok: probeResult === "success", result: probeResult, pathId: "p1" };
    },
  };
  const runtime = createPathReprobeRuntime({ scheduler, executor, pathRegistry, pathManager, evidenceStore, now: () => now });
  return { scheduler, pathRegistry, evidenceStore, runtime, advance(ms) { now += ms; } };
}

test("executes due probe and feeds success into evidence and scheduler", async () => {
  const s = setup("success");
  assert.equal(s.scheduler.schedule("p1").ok, true);
  s.advance(2);
  const [result] = await s.runtime.runDue();
  assert.equal(result.outcome, "success");
  assert.equal(result.recorded.ok, true);
  assert.equal(result.completion.reinstatable, true);
  assert.equal(s.evidenceStore.get("p1", "path").attributes.lastOutcome, "success");
});

test("failed probe is recorded and scheduler enters retry state", async () => {
  const s = setup("failure");
  assert.equal(s.scheduler.schedule("p1").ok, true);
  s.advance(2);
  const [result] = await s.runtime.runDue();
  assert.equal(result.outcome, "failure");
  assert.equal(result.recorded.ok, true);
  assert.equal(result.completion.success, false);
  assert.equal(s.scheduler.get("p1").state, "scheduled");
});

test("missing registry path cannot be probed", async () => {
  const s = setup("success");
  s.pathRegistry.remove("p1");
  assert.equal(s.scheduler.schedule("p1").ok, true);
  s.advance(2);
  const [result] = await s.runtime.runDue();
  assert.equal(result.reason, "path-not-found");
  assert.equal(s.scheduler.get("p1").state, "scheduled");
});
