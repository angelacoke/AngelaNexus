import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { createRuntimePlan } from "../src/core/runtime-plan.js";

test("runtime plan automatically considers all three kernel drivers", () => {
  const result = createRuntimePlan({
    protocol: "socks",
    server: "127.0.0.1",
    port: 1080,
    name: "local-socks",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.ok(Object.values(Kernels).includes(result.backend));
  assert.deepEqual(
    new Set(result.driverSelection.candidates.map((candidate) => candidate.id)),
    new Set(Object.values(Kernels)),
  );
});

test("explicit kernel remains a user-controlled constraint", () => {
  const result = createRuntimePlan({
    protocol: "socks",
    server: "127.0.0.1",
    port: 1080,
    name: "local-socks",
    kernel: Kernels.XRAY,
  });

  assert.equal(result.ok, true);
  assert.equal(result.backend, Kernels.XRAY);
  assert.deepEqual(result.driverSelection.candidates.map((candidate) => candidate.id), [Kernels.XRAY]);
});
