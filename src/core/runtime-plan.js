import { Kernels, NodeProtocols, normalizeNode } from "./model.js";
import { findProtocolAdapter } from "../adapters/protocol-contract.js";
import { findTransportAdapter } from "../adapters/transport-contract.js";
import { builtinProtocolAdapters } from "../adapters/protocol-registry.js";
import { builtinTransportAdapters } from "../adapters/transport-registry.js";
import { missingCapabilities, normalizeCapabilities } from "../adapters/capability-negotiation.js";
import { createDriverSelection } from "./driver-scheduler.js";
import { resolveKernelRuntimeMode } from "../kernel/runtime-boundary.js";

function clone(value) { return value === undefined ? undefined : structuredClone(value); }

function protocolOf(node) {
  return String(node?.protocol || node?.type || "").trim().toLowerCase() || null;
}

function transportOf(node) {
  const type = node?.transport?.type || node?.network || null;
  return type ? String(type).trim().toLowerCase() : null;
}

function capabilityFailure(target, required) {
  const missing = missingCapabilities(target?.capabilities, required);
  return missing.length ? missing : null;
}

export function createRuntimePlan(nodeInput, options = {}) {
  const node = nodeInput?.kind === "node" && nodeInput?.endpoint
    ? clone(nodeInput)
    : normalizeNode(nodeInput);
  if (!node) throw new Error("runtime plan requires a valid canonical node");

  const protocol = protocolOf(node);
  const runtimeKernel = options.kernel || node.kernel || null;
  if (!Object.values(NodeProtocols).includes(protocol)) {
    throw new Error("unsupported node protocol: " + protocol);
  }

  const protocolAdapters = options.protocolAdapters === undefined
    ? builtinProtocolAdapters
    : options.protocolAdapters;
  const transportAdapters = options.transportAdapters === undefined
    ? builtinTransportAdapters
    : options.transportAdapters;

  const protocolAdapter = findProtocolAdapter(protocolAdapters, node);
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

  const requiredProtocolCapabilities = normalizeCapabilities(options.requiredProtocolCapabilities);
  const missingProtocolCapabilities = capabilityFailure(protocolAdapter, requiredProtocolCapabilities);
  if (missingProtocolCapabilities) {
    return {
      ok: false,
      node,
      protocol,
      transport: transportOf(node),
      protocolAdapter: protocolAdapter.protocol,
      status: "unsupported",
      reason: "protocol adapter lacks required capabilities",
      missingCapabilities: missingProtocolCapabilities,
      backend: null,
    };
  }

  const transport = transportOf(node);
  const transportAdapter = transport
    ? findTransportAdapter(transportAdapters, node.transport)
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

  const requiredTransportCapabilities = normalizeCapabilities(options.requiredTransportCapabilities);
  if (requiredTransportCapabilities.length && !transportAdapter) {
    return {
      ok: false,
      node,
      protocol,
      transport,
      protocolAdapter: protocolAdapter.protocol,
      status: "unsupported",
      reason: "required transport capabilities cannot be satisfied without a transport adapter",
      missingCapabilities: requiredTransportCapabilities,
      backend: null,
    };
  }

  if (transportAdapter) {
    const missingTransportCapabilities = capabilityFailure(transportAdapter, requiredTransportCapabilities);
    if (missingTransportCapabilities) {
      return {
        ok: false,
        node,
        protocol,
        transport,
        protocolAdapter: protocolAdapter.protocol,
        transportAdapter: transportAdapter.type,
        status: "unsupported",
        reason: "transport adapter lacks required capabilities",
        missingCapabilities: missingTransportCapabilities,
        backend: null,
      };
    }
  }

  const descriptor = protocolAdapter.describe(node);
  const transportDescriptor = transportAdapter ? transportAdapter.describe(node.transport) : null;

  let runtime = null;
  let effectiveBackendCapabilities = normalizeCapabilities(options.requiredBackendCapabilities);
  if (options.platform !== undefined) {
    if (!runtimeKernel || !Object.values(Kernels).includes(runtimeKernel)) {
      return {
        ok: false,
        node,
        protocol,
        transport,
        status: "unsupported",
        reason: "runtime platform selection requires an explicit supported kernel",
        backend: null,
      };
    }
    const runtimeResolution = resolveKernelRuntimeMode(runtimeKernel, options.platform, {
      requestedMode: options.requestedRuntimeMode || "auto",
      requireNative: options.requireNative === true,
      preferNative: options.preferNative !== false,
    });
    if (!runtimeResolution.ok) {
      return {
        ok: false,
        node,
        protocol,
        transport,
        protocolAdapter: protocolAdapter.protocol,
        transportAdapter: transportAdapter?.type || null,
        status: "unsupported",
        reason: runtimeResolution.reason,
        runtime: runtimeResolution,
        backend: null,
      };
    }
    runtime = runtimeResolution;
    if (runtime.selectedMode === "native") {
      effectiveBackendCapabilities = normalizeCapabilities([
        ...effectiveBackendCapabilities,
        "native-runtime",
      ]);
    }
  }

  const plan = Object.freeze({
    kind: "runtime-plan",
    version: 2,
    node: clone(node),
    kernel: runtimeKernel,
    protocol: Object.freeze({
      id: protocolAdapter.protocol,
      descriptor: clone(descriptor),
    }),
    transport: transportAdapter
      ? Object.freeze({ id: transportAdapter.type, descriptor: clone(transportDescriptor) })
      : null,
    runtime: runtime
      ? Object.freeze({ ...runtime })
      : null,
    requirements: Object.freeze({
      protocol: Object.freeze([...requiredProtocolCapabilities]),
      transport: Object.freeze([...requiredTransportCapabilities]),
      backend: Object.freeze([...effectiveBackendCapabilities]),
    }),
    policy: clone(options.policy || null),
    userAuthorized: options.userAuthorized === true,
  });

  const selection = createDriverSelection({
    plan,
    drivers: options.executionBackends,
    requiredCapabilities: effectiveBackendCapabilities,
    fixedDriver: options.fixedDriver,
    allowedDrivers: options.allowedDrivers,
    preferredDrivers: options.preferredDrivers,
    allowFailover: options.allowFailover === true,
  });

  if (selection.status !== "selected") {
    return {
      ok: false,
      plan,
      status: selection.status,
      reason: selection.explanation,
      backend: null,
      driverSelection: selection,
    };
  }

  if (typeof options.authorize === "function" && options.authorize(plan, selection) !== true) {
    return {
      ok: false,
      plan,
      status: "rejected",
      reason: "runtime plan was not authorized",
      backend: selection.selected.id,
      driverSelection: selection,
    };
  }

  return {
    ok: true,
    plan,
    status: "ready",
    backend: selection.selected.id,
    driverSelection: selection,
  };
}
