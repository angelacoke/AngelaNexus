export const NETWORK_TELEMETRY_VERSION = 1;
export const NETWORK_TELEMETRY_LIMITS = Object.freeze({
  maxFlows: 10000,
  maxStringLength: 512,
  maxCounters: 128,
});

function text(value) {
  return typeof value === "string" ? value.trim().slice(0, NETWORK_TELEMETRY_LIMITS.maxStringLength) : null;
}

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export const FlowEvidenceSources = Object.freeze({
  PLATFORM_API: "platform-api",
  KERNEL: "kernel",
  DNS: "dns",
  SOCKET: "socket",
  RUNTIME_PROBE: "runtime-probe",
  UNKNOWN: "unknown",
});

export function createFlowEvidence({
  originalDestination = null,
  hostname = null,
  processId = null,
  uid = null,
  source = FlowEvidenceSources.UNKNOWN,
  confidence = "unknown",
  observedAt = null,
} = {}) {
  if (!Object.values(FlowEvidenceSources).includes(source)) throw new Error("unsupported flow evidence source");
  if (!["unknown", "observed", "verified"].includes(confidence)) throw new Error("unsupported flow evidence confidence");
  return Object.freeze({
    originalDestination: text(originalDestination),
    hostname: text(hostname),
    processId: Number.isInteger(processId) && processId >= 0 ? processId : null,
    uid: Number.isInteger(uid) && uid >= 0 ? uid : null,
    source,
    confidence,
    observedAt: text(observedAt),
  });
}

export function createFlowTelemetry({
  id,
  backend,
  state = "active",
  evidence = {},
  rttMs = null,
  deliveryRateBps = null,
  pacingRateBps = null,
  retransmissionRatio = null,
  queueingDelayMs = null,
  ecn = null,
  counters = {},
} = {}) {
  const flowId = text(id);
  const backendId = text(backend);
  if (!flowId || !backendId) throw new Error("flow id and backend are required");
  if (!["new", "active", "draining", "closed", "failed"].includes(state)) throw new Error("unsupported flow state");
  const safeCounters = {};
  for (const [key, value] of Object.entries(counters || {}).slice(0, NETWORK_TELEMETRY_LIMITS.maxCounters)) {
    const name = text(key);
    if (name && Number.isFinite(value)) safeCounters[name] = value;
  }
  return Object.freeze({
    version: NETWORK_TELEMETRY_VERSION,
    id: flowId,
    backend: backendId,
    state,
    evidence: Object.freeze(clone(evidence)),
    metrics: Object.freeze({
      rttMs: finite(rttMs),
      deliveryRateBps: finite(deliveryRateBps),
      pacingRateBps: finite(pacingRateBps),
      retransmissionRatio: finite(retransmissionRatio),
      queueingDelayMs: finite(queueingDelayMs),
      ecn: ecn === true ? true : ecn === false ? false : null,
    }),
    counters: Object.freeze(safeCounters),
  });
}

export function summarizeFlowTelemetry(flows = []) {
  const bounded = Array.isArray(flows) ? flows.slice(0, NETWORK_TELEMETRY_LIMITS.maxFlows) : [];
  const active = bounded.filter((flow) => flow && ["new", "active", "draining"].includes(flow.state)).length;
  const draining = bounded.filter((flow) => flow && flow.state === "draining").length;
  return Object.freeze({
    version: NETWORK_TELEMETRY_VERSION,
    flowCount: bounded.length,
    active,
    draining,
    closed: bounded.filter((flow) => flow && flow.state === "closed").length,
    failed: bounded.filter((flow) => flow && flow.state === "failed").length,
  });
}
