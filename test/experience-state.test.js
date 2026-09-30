import test from "node:test";
import assert from "node:assert/strict";
import {
  ExperienceStates,
  canTransition,
  createExperienceState
} from "../src/core/experience-state.js";

test("experience state exposes the complete product lifecycle", () => {
  assert.deepEqual(Object.values(ExperienceStates), [
    "idle",
    "preparing",
    "validating",
    "starting",
    "running",
    "degraded",
    "recovering",
    "stopped",
    "failed"
  ]);
});

test("valid lifecycle transitions are accepted", () => {
  const machine = createExperienceState();
  const path = [
    "preparing",
    "validating",
    "starting",
    "running",
    "degraded",
    "recovering",
    "running",
    "stopped"
  ];

  for (const state of path) {
    const snapshot = machine.transition(state, "test");
    assert.equal(snapshot.state, state);
  }

  assert.equal(machine.snapshot().sequence, path.length);
  assert.equal(machine.history().length, path.length);
});

test("invalid transitions are rejected and do not mutate state", () => {
  const machine = createExperienceState();
  assert.equal(canTransition("idle", "running"), false);
  assert.throws(() => machine.transition("running"), /invalid experience transition/);
  assert.deepEqual(machine.snapshot(), {
    state: "idle",
    reason: null,
    sequence: 0
  });
});

test("recovery and failure preserve bounded reasons", () => {
  const machine = createExperienceState();
  machine.transition("preparing");
  machine.transition("validating");
  machine.transition("starting");
  machine.transition("running");
  machine.transition("recovering", "network changed");
  assert.equal(machine.snapshot().reason, "network changed");
  machine.transition("failed", "x".repeat(600));
  assert.equal(machine.snapshot().reason.length, 512);
  assert.equal(machine.history().length, 6);
});

test("stopped and failed sessions can only re-enter through preparation", () => {
  const stopped = createExperienceState("stopped");
  assert.equal(stopped.canTransition("preparing"), true);
  assert.equal(stopped.canTransition("running"), false);

  const failed = createExperienceState("failed");
  assert.equal(failed.canTransition("preparing"), true);
  assert.equal(failed.canTransition("running"), false);
});
