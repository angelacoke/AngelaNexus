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

test("runtime plan exposes explainable driver-selection failure when no backend is available", () => {
  const result = createRuntimePlan(node(), {
    protocolAdapters: [protocol],
    transportAdapters: [],
    userAuthorized: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.equal(result.driverSelection.status, "unsupported");
  assert.match(result.reason, /No available driver/i);
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
  assert.equal(result.driverSelection.selected.id, "test-backend");
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
  assert.equal(result.driverSelection.status, "unsupported");
  assert.match(result.reason, /No available driver/i);
});

test("runtime plan fails closed when transport capabilities are required but no transport exists", () => {
  const result = createRuntimePlan(node(), {
    protocolAdapters: [protocol],
    requiredTransportCapabilities: ["stream"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
  assert.deepEqual(result.missingCapabilities, ["stream"]);
});

test("runtime plan uses built-in protocol and transport registries when not overridden", () => {
  const result = createRuntimePlan(
    node({ transport: { type: "tcp" } }),
    {
      executionBackends: [backend],
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.plan.protocol.id, NodeProtocols.VLESS);
  assert.equal(result.plan.transport.id, TransportTypes.TCP);
});

test("explicit empty registries still disable built-in discovery", () => {
  const result = createRuntimePlan(node(), {
    protocolAdapters: [],
    transportAdapters: [],
    executionBackends: [backend],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no protocol adapter available");
});

const nativeBackend = createExecutionBackend({
  id: "native-backend",
  capabilities: ["stream-execution", "native-runtime"],
  canExecute: (plan) => plan.runtime?.selectedMode === "native",
  execute: async () => ({ started: true }),
});

test("runtime plan integrates platform runtime capability selection", () => {
  const result = createRuntimePlan(node({ transport: { type: "tcp" } }), {
    kernel: "mihomo",
    platform: "android",
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    executionBackends: [nativeBackend],
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.kernel, "mihomo");
  assert.equal(result.plan.runtime.selectedMode, "native");
  assert.equal(result.plan.requirements.backend.includes("native-runtime"), true);
});

test("runtime plan fails closed when native mode is selected but backend has no native capability", () => {
  const result = createRuntimePlan(node({ transport: { type: "tcp" } }), {
    kernel: "mihomo",
    platform: "android",
    protocolAdapters: [protocol],
    transportAdapters: [tcp],
    executionBackends: [backend],
  });
  assert.equal(result.ok, false);
  assert.equal(result.plan.runtime.selectedMode, "native");
  assert.equal(result.plan.requirements.backend.includes("native-runtime"), true);
  assert.match(result.reason, /No available driver/i);
});

test("runtime plan rejects platform runtime selection without a supported kernel", () => {
  const result = createRuntimePlan(node(), {
    platform: "android",
    protocolAdapters: [protocol],
    transportAdapters: [],
    executionBackends: [backend],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "runtime platform selection requires an explicit supported kernel");
});
