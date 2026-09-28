import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionDecision, createPlannedExecutionContract, validateDecisionPlan, validatePlannedExecutionContract } from "../src/core/decision-planner.js";
import { Kernels } from "../src/core/model.js";

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

test("decision planner produces an execution contract without losing decision evidence", () => {
  const contract = createPlannedExecutionContract({
    id: "plan-001",
    route: { chain: true, hops: ["entry", "exit"] },
    path: { validated: true, networkGeneration: 7, validatedGeneration: 7 },
    security: { preflightPassed: true, failClosed: true, directFallback: false },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, nodes: [] },
    userAuthorized: true
  });
  assert.equal(contract.decision.id, "plan-001");
  assert.equal(contract.decision.action, "chain");
  assert.deepEqual(contract.decision.choice.hops, ["entry", "exit"]);
  assert.equal(contract.kernel, Kernels.SING_BOX);
});

test("planned execution contract cannot bypass authorization or path gates", () => {
  const result = validatePlannedExecutionContract({
    id: "plan-bad-001",
    route: { mode: "proxy", target: "international" },
    path: { validated: true },
    security: { preflightPassed: true, failClosed: true },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, nodes: [] },
    userAuthorized: false
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /authorization/);
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
