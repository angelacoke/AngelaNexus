import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionDecision, validateDecisionPlan } from "../src/core/decision-planner.js";

test("decision planner converts validated proxy route evidence into a decision record", () => {
  const decision = createExecutionDecision({
    id: "route-001",
    route: { mode: "proxy", target: "international" },
    path: { validated: true, networkGeneration: 2, validatedGeneration: 2 },
    security: { preflightPassed: true, failClosed: true }
  });
  assert.equal(decision.action, "routing");
  assert.equal(decision.choice.mode, "proxy");
  assert.equal(decision.context.routeEvidence.target, "international");
});

test("decision planner preserves explicit chain evidence", () => {
  const decision = createExecutionDecision({
    id: "chain-001",
    route: { chain: true, hops: ["entry", "exit"] },
    path: { validated: true },
    security: { preflightPassed: true, failClosed: true }
  });
  assert.equal(decision.action, "chain");
  assert.deepEqual(decision.choice.hops, ["entry", "exit"]);
});

test("decision planner rejects missing security or path evidence", () => {
  assert.throws(
    () => createExecutionDecision({ id: "bad-001", route: { mode: "proxy" } }),
    /validated path/
  );
  assert.equal(
    validateDecisionPlan({ id: "bad-002", route: { mode: "proxy" }, path: { validated: true } }).ok,
    false
  );
});
