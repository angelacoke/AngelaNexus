import test from "node:test";
import assert from "node:assert/strict";
import { Kernels, createKernelAwarePipelinePlan, selectPipelineKernels } from "./pipeline-kernel-plan.js";

const NODE = {
  id: "node-1", name: "Node 1", protocol: "vless",
  server: "example.com", port: 443,
  uuid: "00000000-0000-4000-8000-000000000001",
  tls: true, network: "ws", path: "/",
};

test("proxy pipeline assigns its target through unified kernel selection", () => {
  const plan = createKernelAwarePipelinePlan({
    mode: "proxy",
    target: "node-1",
    nodes: { "node-1": NODE },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.hops.length, 1);
  assert.equal(plan.hops[0].kernel, Kernels.MIHOMO);
  assert.deepEqual(selectPipelineKernels({
    mode: "proxy", target: "node-1", nodes: { "node-1": NODE },
  }), [Kernels.MIHOMO]);
});

test("chain pipeline fails closed when any hop cannot be resolved", () => {
  const plan = createKernelAwarePipelinePlan({
    mode: "chain",
    hops: [{ id: "node-1" }, { id: "missing" }],
    nodes: { "node-1": NODE },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.failedHops[0].id, "missing");
});

test("direct and reject pipelines require no kernel", () => {
  for (const mode of ["direct", "reject"]) {
    const plan = createKernelAwarePipelinePlan({ mode });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.hops, []);
  }
});
