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

import { createRoutingExecutionDecision } from "./decision-planner.js";

test("routing decision is normalized into execution intent before decision creation", () => {
  const result = createRoutingExecutionDecision({
    ...evidence(),
    id: "routing-decision-1",
    routingDecision: {
      status: "matched",
      action: { type: "route", target: "proxy-us" },
      ruleIds: ["app-browser"],
      reason: "application-rule",
    },
    application: { platform: "android", package_name: "com.example.browser" },
  });

  assert.equal(result.intent.kind, "routing-execution-intent");
  assert.equal(result.intent.mode, "proxy");
  assert.equal(result.intent.target, "proxy-us");
  assert.equal(result.decision.choice.target, "proxy-us");
  assert.equal(result.decision.action, "routing");
});

test("reject routing intent remains reject in the execution decision", () => {
  const result = createRoutingExecutionDecision({
    ...evidence(),
    id: "routing-reject-1",
    routingDecision: {
      status: "matched",
      action: { type: "reject" },
      reason: "policy-reject",
    },
  });

  assert.equal(result.intent.mode, "reject");
  assert.equal(result.decision.action, "reject");
  assert.equal(result.decision.choice.mode, "reject");
});

test("chain routing intent preserves ordered hops without selecting a kernel", () => {
  const result = createRoutingExecutionDecision({
    ...evidence(),
    id: "routing-chain-1",
    routingDecision: {
      status: "matched",
      action: { type: "chain", hops: ["node-a", "node-b"] },
      reason: "application-chain",
    },
  });

  assert.equal(result.intent.mode, "chain");
  assert.deepEqual(result.intent.hops, ["node-a", "node-b"]);
  assert.deepEqual(result.decision.choice.hops, ["node-a", "node-b"]);
  assert.equal(result.intent.kernel, undefined);
});
