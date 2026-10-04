import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "./model.js";
import { createKernelAwareExecutionContract } from "./decision-planner.js";

const NODE = {
  id: "node-1", name: "Node 1", protocol: "vless",
  server: "example.com", port: 443,
  uuid: "00000000-0000-4000-8000-000000000001",
  tls: true, network: "ws", path: "/",
};

function evidence() {
  return {
    id: "decision-1",
    route: { mode: "proxy", target: "node-1" },
    path: { validated: true },
    security: { preflightPassed: true, failClosed: true },
    userAuthorized: true,
    confirmed: true,
  };
}

test("decision planning selects a kernel before creating the execution contract", () => {
  const result = createKernelAwareExecutionContract({
    ...evidence(),
    node: NODE,
    configFactory: (kernel) => ({ kernel }),
  });
  assert.equal(result.kernelSelection.ok, true);
  assert.equal(result.contract.kernel, Kernels.MIHOMO);
  assert.equal(result.contract.config.kernel, Kernels.MIHOMO);
});

test("kernel-aware planning preserves an explicit kernel preference", () => {
  const result = createKernelAwareExecutionContract({
    ...evidence(),
    node: NODE,
    kernel: Kernels.XRAY,
    configFactory: (kernel) => ({ kernel }),
  });
  assert.equal(result.contract.kernel, Kernels.XRAY);
});

test("kernel-aware planning fails closed when config does not match selection", () => {
  assert.throws(
    () => createKernelAwareExecutionContract({
      ...evidence(),
      node: NODE,
      configFactory: () => ({ kernel: Kernels.SING_BOX }),
    }),
    /different kernel/
  );
});
