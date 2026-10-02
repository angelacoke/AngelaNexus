export const CONNECTION_PATH_MANAGER_VERSION = 2;

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
} = {}) {
  const policy = Object.freeze({
    failClosed: Boolean(failClosed),
    allowedTypes: Array.isArray(userPolicy.allowedTypes)
      ? Object.freeze([...new Set(userPolicy.allowedTypes.filter((type) => DEFAULT_ALLOWED_TYPES.includes(type)))] )
      : null,
    evidenceMode: userPolicy.evidenceMode === "required" ? "required" : "advisory",
    evidenceSelection: userPolicy.evidenceSelection === "adaptive" ? "adaptive" : "user-order",
    preferredOrder: Array.isArray(userPolicy.preferredOrder)
      ? Object.freeze([...new Set(userPolicy.preferredOrder.filter((type) => DEFAULT_ALLOWED_TYPES.includes(type)))])
      : Object.freeze([]),
  });

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
      return Object.freeze({
        ok: true,
        mode: "verified-path",
        selected,
        eligible: Object.freeze(evidenceEligible),
        rejected: Object.freeze(normalized.filter((candidate) => !evidenceEligible.includes(candidate))), Object.freeze(normalized.filter((candidate) => candidate !== selected && !eligible.includes(candidate))),
        reason: "verified-path-available",
      });
    }

    return Object.freeze({
      ok: false,
      mode: policy.failClosed ? "fail-closed" : "no-verified-path",
      selected: null,
      eligible: Object.freeze([]),
      rejected: Object.freeze(normalized),
      reason: policy.failClosed ? "no-verified-path-fail-closed" : "no-verified-path",
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
  });
}
