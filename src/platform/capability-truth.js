export const CAPABILITY_TRUTH_VERSION = 1;

export const CapabilityTruthStates = Object.freeze({
  DECLARED: "declared",
  SUPPORTED: "supported",
  VERIFIED: "verified",
  OPERATIONAL: "operational",
  HEALTHY: "healthy",
});

const ORDER = Object.freeze([
  CapabilityTruthStates.DECLARED,
  CapabilityTruthStates.SUPPORTED,
  CapabilityTruthStates.VERIFIED,
  CapabilityTruthStates.OPERATIONAL,
  CapabilityTruthStates.HEALTHY,
]);

function normalizeId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function evidenceFlag(evidence, key) {
  return evidence && evidence[key] === true;
}

export function evaluateCapabilityTruth({
  id,
  declared = false,
  supported = false,
  verified = false,
  operational = false,
  healthy = false,
  evidence = {},
} = {}) {
  const capabilityId = normalizeId(id);
  if (!capabilityId) throw new Error("capability id is required");

  const states = [];
  if (declared) states.push(CapabilityTruthStates.DECLARED);
  if (declared && supported) states.push(CapabilityTruthStates.SUPPORTED);
  if (declared && supported && verified) states.push(CapabilityTruthStates.VERIFIED);
  if (declared && supported && verified && operational) states.push(CapabilityTruthStates.OPERATIONAL);
  if (declared && supported && verified && operational && healthy) states.push(CapabilityTruthStates.HEALTHY);

  const state = states.length ? states[states.length - 1] : null;
  const contradictions = [];
  if (supported && !declared) contradictions.push("supported-without-declaration");
  if (verified && !supported) contradictions.push("verified-without-support");
  if (operational && !verified) contradictions.push("operational-without-verification");
  if (healthy && !operational) contradictions.push("healthy-without-operational");

  return Object.freeze({
    version: CAPABILITY_TRUTH_VERSION,
    id: capabilityId,
    state,
    rank: state ? ORDER.indexOf(state) : -1,
    states: Object.freeze(states),
    evidence: Object.freeze({ ...evidence }),
    contradictions: Object.freeze(contradictions),
    ok: contradictions.length === 0,
  });
}

export function capabilityTruthFromBackend(backend, evidence = {}, runtime = {}) {
  if (!backend || typeof backend !== "object") throw new Error("backend is required");
  const verified = backend.maturity === "supported" || evidence[backend.id] === true;
  const operational = verified && runtime.operational === true;
  const healthy = operational && runtime.healthy === true;
  return evaluateCapabilityTruth({
    id: backend.id,
    declared: true,
    supported: backend.maturity === "supported" || backend.maturity === "capability-gated",
    verified,
    operational,
    healthy,
    evidence: {
      declaration: true,
      maturity: backend.maturity,
      runtimeProbe: evidence[backend.id] === true,
      operational: runtime.operational === true,
      healthy: runtime.healthy === true,
      ...evidence,
    },
  });
}

export function requireCapabilityTruth(result, minimumState = CapabilityTruthStates.VERIFIED) {
  if (!result || result.ok !== true) return false;
  const requiredRank = ORDER.indexOf(minimumState);
  return requiredRank >= 0 && result.rank >= requiredRank;
}
