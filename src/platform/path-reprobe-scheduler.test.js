import test from "node:test";
import assert from "node:assert/strict";
import { createPathReprobeScheduler, ReprobeStates } from "./path-reprobe-scheduler.js";

function clock() {
  let value = 1_000_000;
  return {
    now: () => value,
    advance(ms) { value += ms; },
  };
}

test("scheduler is disabled by default and creates no probe task", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({ now: time.now });
  assert.equal(scheduler.schedule("direct").ok, false);
  assert.equal(scheduler.schedule("direct").reason, "disabled");
});

test("scheduler honors low-power minimum interval and exponential backoff", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: {
      enabled: true,
      baseBackoffMs: 10_000,
      minIntervalMs: 20_000,
      lowPowerMinIntervalMs: 60_000,
      maxBackoffMs: 120_000,
    },
  });
  const result = scheduler.schedule("relay");
  assert.equal(result.ok, true);
  assert.equal(result.task.state, ReprobeStates.SCHEDULED);
  assert.equal(result.task.nextAttemptAt, 1_000_000 + 60_000);
});

test("scheduler does not create probe storms while a task is pending", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1_000 },
  });
  const first = scheduler.schedule("relay");
  const second = scheduler.schedule("relay");
  assert.equal(first.ok, true);
  assert.equal(second.reason, "already-scheduled");
  assert.equal(scheduler.list().length, 1);
});

test("probe lifecycle requires due scheduling and security gates", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1_000, maxAttempts: 2 },
  });
  scheduler.schedule("relay");
  assert.equal(scheduler.begin("relay").reason, "not-due");

  time.advance(1_000);
  const begun = scheduler.begin("relay");
  assert.equal(begun.ok, true);
  const failed = scheduler.complete("relay", { success: true, securityHealthy: false });
  assert.equal(failed.success, false);
  assert.equal(failed.task.state, ReprobeStates.SCHEDULED);
});

test("successful probe enters cooldown and is explicitly reinstatable", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1_000, cooldownMs: 5_000 },
  });
  scheduler.schedule("relay");
  time.advance(1_000);
  assert.equal(scheduler.begin("relay").ok, true);
  const result = scheduler.complete("relay", { success: true, securityHealthy: true, userAllowed: true, verified: true });
  assert.equal(result.success, true);
  assert.equal(result.reinstatable, true);
  assert.equal(result.task.state, ReprobeStates.COOLDOWN);
});

test("failed probes are bounded by max attempts", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1_000, maxAttempts: 2, cooldownMs: 5_000 },
  });
  scheduler.schedule("relay");
  time.advance(1_000);
  scheduler.begin("relay");
  const first = scheduler.complete("relay", { success: false });
  assert.equal(first.task.state, ReprobeStates.SCHEDULED);
  time.advance(2_000);
  scheduler.begin("relay");
  const second = scheduler.complete("relay", { success: false });
  assert.equal(second.task.state, ReprobeStates.COOLDOWN);
  assert.equal(second.task.attempts, 2);
});

test("cancel prevents a scheduled probe from being returned as ready", () => {
  const time = clock();
  const scheduler = createPathReprobeScheduler({
    now: time.now,
    userPolicy: { enabled: true, lowPower: false, baseBackoffMs: 1_000 },
  });
  scheduler.schedule("relay");
  scheduler.cancel("relay");
  time.advance(10_000);
  assert.equal(scheduler.poll().length, 0);
  assert.equal(scheduler.get("relay").state, ReprobeStates.CANCELLED);
});
