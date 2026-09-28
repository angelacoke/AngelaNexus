import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionContract, validateExecutionContract } from "../src/core/execution-contract.js";
import { Kernels } from "../src/core/model.js";

const base = {
  decision: { id: "decision-001", version: 1 },
  kernel: Kernels.SING_BOX,
  config: { kernel: Kernels.SING_BOX, nodes: [] },
  userAuthorized: true,
  security: { preflightPassed: true, failClosed: true, directFallback: false },
  path: { validated: true, networkGeneration: 4, validatedGeneration: 4 }
};

test("execution contract freezes system decision and execution gates", () => {
  const contract = createExecutionContract(base);
  assert.equal(contract.version, 1);
  assert.equal(contract.decision.id, "decision-001");
  assert.equal(contract.kernel, Kernels.SING_BOX);
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.decision), true);
});

test("confirmed GFW state requires a revalidated execution path", () => {
  assert.throws(
    () => createExecutionContract({ ...base, gfw: { state: "confirmed" } }),
    /GFW path revalidation/
  );
  const contract = createExecutionContract({
    ...base,
    gfw: { state: "confirmed" },
    path: { ...base.path, gfwValidated: true }
  });
  assert.equal(contract.gfw.state, "confirmed");
});

test("execution contract rejects stale network validation and direct fallback", () => {
  assert.throws(
    () => createExecutionContract({
      ...base,
      path: { validated: true, networkGeneration: 5, validatedGeneration: 4 }
    }),
    /stale network path/
  );
  assert.throws(
    () => createExecutionContract({
      ...base,
      security: { ...base.security, directFallback: true }
    }),
    /direct fallback/
  );
});

test("contract validation returns structured failure without throwing", () => {
  const result = validateExecutionContract({ ...base, userAuthorized: false });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /authorization/);
});
