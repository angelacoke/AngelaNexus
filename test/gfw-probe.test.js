import test from "node:test";
import assert from "node:assert/strict";
import { createGfwProbeCoordinator } from "../src/core/gfw-probe.js";
import { GfwSignals } from "../src/core/gfw-policy.js";
import { ResourceModes } from "../src/core/resource-policy.js";

function fakeRuntime() {
  const observations = [];
  return {
    observations,
    observe(input, now) {
      observations.push({ input, now });
      return { state: "suspected", signals: [input.signal], actions: ["observe"] };
    }
  };
}

test("GFW probe coordinator records kernel-neutral evidence", async () => {
  const runtime = fakeRuntime();
  const coordinator = createGfwProbeCoordinator({
    gfwRuntime: runtime,
    resourcePolicy: { mode: ResourceModes.EFFICIENT }
  });
  const result = await coordinator.run(async () => ({
    ok: false,
    signal: GfwSignals.TCP_RESET,
    transport: "tls",
    destination: "example.com"
  }), { now: 1000 });

  assert.equal(result.status, "observed");
  assert.equal(runtime.observations.length, 1);
  assert.equal(runtime.observations[0].input.signal, GfwSignals.TCP_RESET);
  assert.equal(coordinator.getIntervalMs(), 60000);
});

test("active GFW probing requires explicit user choice", async () => {
  const runtime = fakeRuntime();
  const coordinator = createGfwProbeCoordinator({
    gfwRuntime: runtime,
    activeProbeEnabled: true
  });
  const result = await coordinator.run(async () => ({
    signal: GfwSignals.ACTIVE_PROBE_SUSPECTED
  }), { active: true, userChoice: false });

  assert.equal(result.status, "blocked");
  assert.equal(runtime.observations.length, 0);
});

test("resource state reduces scheduled GFW probe work", () => {
  const runtime = fakeRuntime();
  const coordinator = createGfwProbeCoordinator({
    gfwRuntime: runtime,
    resourcePolicy: { mode: ResourceModes.PERFORMANCE }
  });
  assert.equal(coordinator.getIntervalMs(), 15000);
  assert.equal(coordinator.updateResourceState({ lowPower: true }), 60000);
  coordinator.stop();
});

test("disabled scheduler does not create background probing", () => {
  const runtime = fakeRuntime();
  const coordinator = createGfwProbeCoordinator({
    gfwRuntime: runtime,
    enabled: false
  });
  coordinator.start(async () => ({ signal: GfwSignals.TCP_RESET }));
  assert.equal(coordinator.scheduler.timer, null);
});
