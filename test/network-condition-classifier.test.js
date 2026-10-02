import test from "node:test";
import assert from "node:assert/strict";
import {
  NetworkConditions,
  classifyNetworkCondition,
  isSafeForLossCompensation,
} from "../src/platform/network-condition-classifier.js";

test("insufficient evidence stays unknown", () => {
  const result = classifyNetworkCondition({});
  assert.equal(result.condition, NetworkConditions.UNKNOWN);
  assert.equal(result.confidence, "insufficient-data");
});

test("queueing evidence prevents random-loss classification", () => {
  const result = classifyNetworkCondition({
    rttMs: 180,
    baseRttMs: 100,
    queueingDelayMs: 80,
    retransmissionRatio: 0.2,
    samples: 20,
  });
  assert.equal(result.condition, NetworkConditions.QUEUE_CONGESTION);
  assert.equal(isSafeForLossCompensation(result), false);
});

test("high-confidence isolated loss can qualify for compensation", () => {
  const result = classifyNetworkCondition({
    rttMs: 100,
    baseRttMs: 95,
    queueingDelayMs: 2,
    retransmissionRatio: 0.1,
    ecnRatio: 0,
    samples: 20,
  });
  assert.equal(result.condition, NetworkConditions.RANDOM_LOSS);
  assert.equal(result.confidence, "high");
  assert.equal(isSafeForLossCompensation(result), true);
});
