import test from "node:test";
import assert from "node:assert/strict";
import { NodeProtocols } from "../src/core/model.js";
import { createProtocolAdapter } from "../src/adapters/protocol-contract.js";
import { createTransportAdapter, TransportTypes } from "../src/adapters/transport-contract.js";
import { createExecutionBackend } from "../src/adapters/execution-backend-contract.js";
import { createRuntimePlan } from "../src/core/runtime-plan.js";
import { missingCapabilities, satisfiesCapabilities } from "../src/adapters/capability-negotiation.js";

const protocol = createProtocolAdapter({
  protocol: NodeProtocols.VLESS,
  capabilities: ["stream-open"],
  canHandle: (node) => node.protocol === NodeProtocols.VLESS,
  describe: (node) => ({ protocol: node.protocol }),
});

const tcp = createTransportAdapter({
  type: TransportTypes.TCP,
  capabilities: ["stream"],
  canHandle: (transport) => transport?.type === TransportTypes.TCP,
  describe: (transport) => ({ type: transport.type }),
});

const backend = createExecutionBackend({
  id: "test-backend",
  capabilities: ["stream-execution"],
  canExecute: (plan) => plan.protocol.id === NodeProtocols.VLESS && plan.transport?.id === TransportTypes.TCP,
  execute: async () => ({ started: true }),
});

function node(overrides = {}) {
  return {
    id: "n1",
    name: "n1",
    protocol: NodeProtocols.VLESS,
    server: "example.invalid",
    port: 443,
    ...overrides,
  };
}

test("runtime plan remains backend-neutral before backend selection", () => {
  const result = createRuntimePlan(node(), {
    protocolAdapters: [protocol],
    transportAdapters: [],
    userAuthorized: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "no execution backend can execute this plan");
  assert.equal(result.plan.kind, "runtime-plan");
  assert.equal(result.plan.protocol.id, "vless");
  assert.equal(result.plan.transport, null);
  assert.equal(result.backend, null);
});

test("runtime plan separates protocol and transport selection", () => {
  const result = createRuntimePlan(
    node({ transport: { type: "tcp" } }),
    {
      protocolAdapters: [protocol],
      transportAdapters: [tcp],
      executionBackends: [backend],
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan.protocol.id, "vless");
  assert.equal(result.plan.transport.id, "tcp");
});

test("unsupported transport fails closed without backend execution", () => {
  let executed = false;
  const guardedBackend = createExecutionBackend({
    id: "guarded",
    capabilities: ["stream-execution"],
    canExecute: () => { executed = true; return true; },
    execute: async () => ({ started: true }),
  });
  const result = createRuntimePlan(node({ transport: { type: "unknown" } }), {
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    executionBackends: [guardedBackend],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.equal(executed, false);
});

test("backend is not consulted when protocol adapter is unavailable", () => {
  let consulted = false;
  const guardedBackend = createExecutionBackend({
    id: "guarded",
    capabilities: ["stream-execution"],
    canExecute: () => { consulted = true; return true; },
    execute: async () => ({ started: true }),
  });
  const result = createRuntimePlan(node(), {
    protocolAdapters: [],
    transportAdapters: [],
    executionBackends: [guardedBackend],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.equal(consulted, false);
});

test("authorization can reject a valid runtime plan before execution", () => {
  const result = createRuntimePlan(node({ transport: { type: "tcp" } }), {
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    executionBackends: [backend],
    authorize: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "rejected");
  assert.equal(result.backend, "test-backend");
});


test("capability negotiation reports missing capabilities without guessing", () => {
  assert.deepEqual(missingCapabilities(["stream"], ["stream", "datagram"]), ["datagram"]);
  assert.equal(satisfiesCapabilities(["stream", "datagram"], ["stream"]), true);
  assert.equal(satisfiesCapabilities(["stream"], ["datagram"]), false);
});

test("runtime plan rejects a protocol adapter missing required capabilities", () => {
  const result = createRuntimePlan(node(), {
    protocolAdapters: [protocol],
    requiredProtocolCapabilities: ["datagram-open"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.missingCapabilities, ["datagram-open"]);
});

test("runtime plan rejects a transport adapter missing required capabilities", () => {
  const result = createRuntimePlan(node({ transport: { type: "tcp" } }), {
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    requiredTransportCapabilities: ["secure"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.missingCapabilities, ["secure"]);
});

test("runtime plan selects only a backend satisfying required capabilities", () => {
  const result = createRuntimePlan(node({ transport: { type: "tcp" } }), {
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    executionBackends: [backend],
    requiredBackendCapabilities: ["datagram-execution"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.equal(result.reason, "no execution backend can execute this plan with required capabilities");
});
