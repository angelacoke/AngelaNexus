import test from "node:test";
import assert from "node:assert/strict";
import { NetworkLifecycle } from "./network-lifecycle.js";

function createLifecycle() {
  const events = [];
  const lifecycle = new NetworkLifecycle({
    evidenceStore: { record: async (e) => events.push(e) },
    clock: () => new Date("2026-10-02T13:00:00.000Z"),
  });
  return { lifecycle, events };
}

test("normal lifecycle reaches running only through preparing and applying", async () => {
  const { lifecycle, events } = createLifecycle();
  await lifecycle.transition("preparing", { reason: "start-request" });
  await lifecycle.transition("applying", { reason: "capabilities-verified" });
  await lifecycle.transition("running", { reason: "live-verified" });
  assert.equal(lifecycle.snapshot().state, "running");
  assert.deepEqual(events.map((e) => e.to), ["preparing", "applying", "running"]);
});

test("invalid transition is rejected without changing state", async () => {
  const { lifecycle } = createLifecycle();
  await assert.rejects(() => lifecycle.transition("running"), /invalid network lifecycle transition/);
  assert.equal(lifecycle.snapshot().state, "stopped");
});

test("degraded runtime follows recovery and cleanup verification", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.transition("preparing");
  await lifecycle.transition("applying");
  await lifecycle.transition("running");
  await lifecycle.transition("degraded", { reason: "traffic-failed" });
  await lifecycle.recover({ reason: "rollback-required" });
  await lifecycle.restore({ reason: "cleanup-verified" });
  assert.equal(lifecycle.snapshot().state, "restored");
  await lifecycle.transition("stopped", { reason: "restored-runtime-stopped" });
  assert.equal(lifecycle.snapshot().state, "stopped");
});

test("recovery cannot be marked restored before entering recovery", async () => {
  const { lifecycle } = createLifecycle();
  await assert.rejects(() => lifecycle.restore(), /restore requires recovering state/);
});
