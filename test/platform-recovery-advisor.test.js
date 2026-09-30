import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_FAILURE_ACTIONS,
  advisePlatformFailure,
  createPlatformFailureState,
  createPlatformRecoveryOptions,
} from "../src/platform/index.js";

test("platform failure produces actionable recovery options", () => {
  const result = advisePlatformFailure({
    capability: "warp",
    reason: "user-scoped landing is unavailable",
    details: "当前 WARP 落地不可用。",
    alternatives: [{ id: "us-node", enabled: true }],
    actions: [
      PLATFORM_FAILURE_ACTIONS.REGENERATE,
      PLATFORM_FAILURE_ACTIONS.SWITCH_LANDING,
      PLATFORM_FAILURE_ACTIONS.RECHECK,
      PLATFORM_FAILURE_ACTIONS.REJECT,
    ],
  });

  assert.equal(result.failure.failClosed, true);
  assert.equal(result.notice.message, "当前 WARP 落地不可用。");
  assert.deepEqual(result.recovery.options.map((item) => item.action), [
    "regenerate",
    "switch-landing",
    "recheck",
    "reject",
  ]);
});

test("platform recovery never invents a landing alternative", () => {
  const failure = createPlatformFailureState({
    capability: "landing",
    reason: "no usable landing endpoint",
  });
  const recovery = createPlatformRecoveryOptions({
    failure,
    actions: [PLATFORM_FAILURE_ACTIONS.SWITCH_LANDING, PLATFORM_FAILURE_ACTIONS.REJECT],
  });

  assert.deepEqual(recovery.options.map((item) => item.action), ["reject"]);
  assert.equal(recovery.alternatives.length, 0);
});

test("platform failure defaults to fail-closed recovery", () => {
  const result = advisePlatformFailure({
    capability: "warp",
    reason: "credential unavailable",
  });

  assert.equal(result.failure.failClosed, true);
  assert.equal(result.notice.failClosed, true);
  assert.ok(result.notice.options.some((item) => item.action === "reject"));
});
