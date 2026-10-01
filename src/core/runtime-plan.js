import { NodeProtocols, normalizeNode } from "./model.js";
import { findProtocolAdapter } from "../adapters/protocol-contract.js";
import { findTransportAdapter } from "../adapters/transport-contract.js";
import { findExecutionBackend } from "../adapters/execution-backend-contract.js";

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

function protocolOf(node) {
  return String(node?.protocol || node?.type || "").trim().toLowerCase() || null;
}

function transportOf(node) {
  const type = node?.transport?.type || node?.network || null;
  return type ? String(type).trim().toLowerCase() : null;
}

export function createRuntimePlan(nodeInput, options = {}) {
  const node = nodeInput?.kind === "node" && nodeInput?.endpoint
    ? clone(nodeInput)
    : normalizeNode(nodeInput);
  if (!node) throw new Error("runtime plan requires a valid canonical node");

  const protocol = protocolOf(node);
  if (!Object.values(NodeProtocols).includes(protocol)) {
    throw new Error("unsupported node protocol: " + protocol);
  }

  const protocolAdapter = findProtocolAdapter(options.protocolAdapters, node);
  if (!protocolAdapter) {
    return {
      ok: false,
      node,
      protocol,
      transport: transportOf(node),
      status: "unsupported",
      reason: "no protocol adapter available",
      backend: null,
    };
  }

  const transport = transportOf(node);
  const transportAdapter = transport
    ? findTransportAdapter(options.transportAdapters, node.transport)
    : null;

  if (transport && !transportAdapter) {
    return {
      ok: false,
      node,
      protocol,
      transport,
      protocolAdapter: protocolAdapter.protocol,
      status: "unsupported",
      reason: "no transport adapter available",
      backend: null,
    };
  }

  const descriptor = protocolAdapter.describe(node);
  const transportDescriptor = transportAdapter ? transportAdapter.describe(node.transport) : null;
  const plan = Object.freeze({
    kind: "runtime-plan",
    version: 1,
    node: clone(node),
    protocol: Object.freeze({
      id: protocolAdapter.protocol,
      descriptor: clone(descriptor),
    }),
    transport: transportAdapter
      ? Object.freeze({ id: transportAdapter.type, descriptor: clone(transportDescriptor) })
      : null,
    policy: clone(options.policy || null),
    userAuthorized: options.userAuthorized === true,
  });

  const backend = findExecutionBackend(options.executionBackends, plan);
  if (!backend) {
    return {
      ok: false,
      plan,
      status: "unsupported",
      reason: "no execution backend can execute this plan",
      backend: null,
    };
  }

  if (typeof options.authorize === "function" && options.authorize(plan) !== true) {
    return {
      ok: false,
      plan,
      status: "rejected",
      reason: "runtime plan was not authorized",
      backend: backend.id,
    };
  }

  return {
    ok: true,
    plan,
    status: "ready",
    backend: backend.id,
  };
}
