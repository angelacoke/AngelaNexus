export const CONNECTION_PATH_MANAGER_VERSION = 3;

export const ConnectionPathTypes = Object.freeze({
  DIRECT: "direct",
  KERNEL_TUNNEL: "kernel-tunnel",
  USERSPACE: "userspace",
  RELAY: "relay",
  CHAIN: "chain",
});

export const ConnectionPathTrust = Object.freeze({
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  REJECTED: "rejected",
});

const DEFAULT_ALLOWED_TYPES = Object.freeze(Object.values(ConnectionPathTypes));

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const type = candidate.type;
  if (!DEFAULT_ALLOWED_TYPES.includes(type)) return null;
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null;
  const trust = candidate.trust;
  const health = candidate.health;
  return Object.freeze({
    ...candidate,
    id,
    type,
    trust,
    health,
    verified: candidate.verified === true,
    securityHealthy: candidate.securityHealthy === true,
    userAllowed: candidate.userAllowed !== false,
  });
}

function allowedType(policy, type) {
  const value = policy.allowedTypes;
  return Array.isArray(value) && value.length > 0 ? value.includes(type) : true;
}

function admissible(candidate, policy) {
  return Boolean(
    candidate &&
    candidate.verified === true &&
    candidate.trust === ConnectionPathTrust.VERIFIED &&
    candidate.health === "healthy" &&
    candidate.securityHealthy === true &&
    candidate.userAllowed === true &&
    allowedType(policy, candidate.type),
  );
}

function evidenceScore(evidence) {
  if (!evidence || typeof evidence !== "object") return 0;
  const metrics = evidence.metrics || {};
  let score = 0;
  let signals = 0;
  if (Number.isFinite(metrics.rttMs)) { score += Math.max(0, 1 - Math.min(metrics.rttMs, 2000) / 2000); signals += 1; }
  if (Number.isFinite(metrics.lossRatio)) { score += Math.max(0, 1 - Math.min(Math.max(metrics.lossRatio, 0), 1)); signals += 1; }
  if (Number.isFinite(metrics.retransmissionRatio)) { score += Math.max(0, 1 - Math.min(Math.max(metrics.retransmissionRatio, 0), 1)); signals += 1; }
  if (Number.isFinite(metrics.deliveryRate)) { score += Math.min(Math.max(metrics.deliveryRate, 0), 1); signals += 1; }
  const confidence = Number.isFinite(evidence.confidence) ? Math.max(0, Math.min(evidence.confidence, 1)) : 0.5;
  return signals ? (score / signals) * confidence : 0;
}

function chooseByOrder(candidates, order, evidenceById = new Map(), adaptive = false) {
  const rank = new Map((Array.isArray(order) ? order : []).map((type, index) => [type, index]));
  return [...candidates].sort((a, b) => {
    const ar = rank.has(a.type) ? rank.get(a.type) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.type) ? rank.get(b.type) : Number.MAX_SAFE_INTEGER;
    if (!adaptive && ar !== br) return ar - br;
    if (adaptive) {
      const as = evidenceScore(evidenceById.get(a.id));
      const bs = evidenceScore(evidenceById.get(b.id));
      if (as !== bs) return bs - as;
      if (ar !== br) return ar - br;
    }
    return String(a.id || "").localeCompare(String(b.id || ""));
  })[0] || null;
}

export function createConnectionPathManager({
  userPolicy = {},
  failClosed = true,
  now = () => Date.now(),
} = {}) {
  if (typeof now !== "function") throw new Error("now must be a function");
  const policy = Object.freeze({
    failClosed: Boolean(failClosed),
    allowedTypes: Array.isArray(userPolicy.allowedTypes)
      ? Object.freeze([...new Set(userPolicy.allowedTypes.filter((type) => DEFAULT_ALLOWED_TYPES.includes(type)))] )
      : null,
    evidenceMode: userPolicy.evidenceMode === "required" ? "required" : "advisory",
    evidenceSelection: userPolicy.evidenceSelection === "adaptive" ? "adaptive" : "user-order",
    reprobePolicy: userPolicy.reprobePolicy === "disabled"
      ? "disabled"
      : userPolicy.reprobePolicy === "on-failure"
        ? "on-failure"
        : "on-degraded-or-failure",
    preferredOrder: Array.isArray(userPolicy.preferredOrder)
      ? Object.freeze([...new Set(userPolicy.preferredOrder.filter((type) => DEFAULT_ALLOWED_TYPES.includes(type)))])
      : Object.freeze([]),
  });

  let decisionSequence = 0;

  function nextDecisionId() {
    decisionSequence += 1;
    return "path-decision-" + String(decisionSequence);
  }

  function evaluate(candidates = [], { evidenceStore = null } = {}) {
    const normalized = (Array.isArray(candidates) ? candidates : [])
      .map(normalizeCandidate)
      .filter(Boolean);
    const eligible = normalized.filter((candidate) => admissible(candidate, policy));
    const evidence = evidenceStore && typeof evidenceStore.list === "function"
      ? evidenceStore.list("path")
      : [];
    const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
    const evidenceEligible = policy.evidenceMode === "required"
      ? eligible.filter((candidate) => evidenceById.has(candidate.id))
      : eligible;
    const selected = chooseByOrder(
      evidenceEligible,
      policy.preferredOrder,
      evidenceById,
      policy.evidenceSelection === "adaptive",
    );

    if (selected) {
      const selectedEvidence = evidenceById.get(selected.id) || null;
      const decisionId = nextDecisionId();
      return Object.freeze({
        ok: true,
        decisionId,
        evaluatedAt: now(),
        selectedEvidenceScore: evidenceScore(selectedEvidence),
        mode: "verified-path",
        selected,
        eligible: Object.freeze(evidenceEligible),
        rejected: Object.freeze(normalized.filter((candidate) => !evidenceEligible.includes(candidate))),
        reason: "verified-path-available",
      });
    }

    return Object.freeze({
      ok: false,
      decisionId: nextDecisionId(),
      evaluatedAt: now(),
      mode: policy.failClosed ? "fail-closed" : "no-verified-path",
      selected: null,
      eligible: Object.freeze([]),
      rejected: Object.freeze(normalized),
      reason: policy.failClosed ? "no-verified-path-fail-closed" : "no-verified-path",
    });
  }

  function recordOutcome({
    pathId,
    outcome,
    evidenceStore = null,
    metrics = {},
    confidence = null,
    source = "path-outcome",
    decisionId = null,
    attributes = {},
  } = {}) {
    const id = typeof pathId === "string" ? pathId.trim() : "";
    const allowedOutcomes = new Set(["success", "degraded", "failure"]);
    if (!id || !allowedOutcomes.has(outcome)) {
      return Object.freeze({ ok: false, reason: "invalid-outcome" });
    }
    if (!evidenceStore || typeof evidenceStore.record !== "function") {
      return Object.freeze({ ok: false, reason: "evidence-store-required" });
    }

    const previous = typeof evidenceStore.get === "function" ? evidenceStore.get(id, "path") : null;
    const previousAttributes = previous?.attributes || {};
    const previousSamples = Number.isFinite(previous?.metrics?.sampleCount) ? previous.metrics.sampleCount : 0;
    const counts = {
      success: Number.isFinite(previousAttributes.successCount) ? previousAttributes.successCount : 0,
      degraded: Number.isFinite(previousAttributes.degradedCount) ? previousAttributes.degradedCount : 0,
      failure: Number.isFinite(previousAttributes.failureCount) ? previousAttributes.failureCount : 0,
    };
    counts[outcome] += 1;
    const mergedMetrics = {
      ...(previous?.metrics || {}),
      ...(metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {}),
      sampleCount: previousSamples + 1,
    };
    const result = evidenceStore.record({
      id,
      kind: "path",
      observedAt: now(),
      source,
      confidence: confidence ?? previous?.confidence ?? 0.5,
      metrics: mergedMetrics,
      attributes: {
        ...previousAttributes,
        ...attributes,
        decisionId: decisionId || previousAttributes.decisionId || null,
        lastOutcome: outcome,
        successCount: counts.success,
        degradedCount: counts.degraded,
        failureCount: counts.failure,
      },
    });
    if (!result.ok) return result;

    const reprobeRecommended = policy.reprobePolicy !== "disabled" &&
      (outcome === "failure" || (outcome === "degraded" && policy.reprobePolicy === "on-degraded-or-failure"));
    return Object.freeze({
      ok: true,
      outcome,
      pathId: id,
      decisionId,
      reprobeRecommended,
      evidence: result.evidence,
    });
  }

  function evaluateRegistry(registry, evidenceStore = null) {
    if (!registry || typeof registry.list !== "function") {
      return evaluate([], { evidenceStore });
    }
    return evaluate(registry.list(), { evidenceStore });
  }

  return Object.freeze({
    version: CONNECTION_PATH_MANAGER_VERSION,
    snapshot() {
      return Object.freeze({ version: CONNECTION_PATH_MANAGER_VERSION, policy });
    },
    evaluate,
    evaluateRegistry,
    recordOutcome,
  });
}
