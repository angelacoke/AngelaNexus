import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateNetworkOptimizationPreflight,
  OptimizationActions,
} from "../src/platform/network-optimization-preflight.js";
import { classifyNetworkCondition } from "../src/platform/network-condition-classifier.js";

test("optimization remains blocked without security and capability verification", () => {
  const classification = classifyNetworkCondition({ rttMs: 100, baseRttMs: 95, retransmissionRatio: 0.1, samples: 20 });
  const result = evaluateNetworkOptimizationPreflight({
    classification,
    requestedAction: OptimizationActions.LOSS_COMPENSATION,
    capabilityVerified: true,
    securityHealthy: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "security-not-healthy");
});

test("loss compensation requires high-confidence random-loss evidence", () => {
  const classification = classifyNetworkCondition({
    rttMs: 180,
    baseRttMs: 100,
    queueingDelayMs: 80,
    retransmissionRatio: 0.2,
    samples: 20,
  });
  const result = evaluateNetworkOptimizationPreflight({
    classification,
    requestedAction: OptimizationActions.LOSS_COMPENSATION,
    capabilityVerified: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, false);
});

test("conservative optimization is allowed only for non-congested known conditions", () => {
  const classification = classifyNetworkCondition({
    rttMs: 100,
    baseRttMs: 95,
    queueingDelayMs: 2,
    samples: 10,
  });
  const result = evaluateNetworkOptimizationPreflight({
    classification,
    requestedAction: OptimizationActions.CONSERVATIVE,
    capabilityVerified: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, OptimizationActions.CONSERVATIVE);
});
