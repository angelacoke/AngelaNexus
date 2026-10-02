export const CONNECTION_PATH_MANAGER_VERSION = 1;

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

function chooseByOrder(candidates, order) {
  const rank = new Map((Array.isArray(order) ? order : []).map((type, index) => [type, index]));
  return [...candidates].sort((a, b) => {
    const ar = rank.has(a.type) ? rank.get(a.type) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.type) ? rank.get(b.type) : Number.MAX_SAFE_INTEGER;
    if (ar !== br) return ar - br;
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
    preferredOrder: Array.isArray(userPolicy.preferredOrder)
      ? Object.freeze([...new Set(userPolicy.preferredOrder.filter((type) => DEFAULT_ALLOWED_TYPES.includes(type)))])
      : Object.freeze([]),
  });

  function evaluate(candidates = []) {
    const normalized = (Array.isArray(candidates) ? candidates : [])
      .map(normalizeCandidate)
      .filter(Boolean);
    const eligible = normalized.filter((candidate) => admissible(candidate, policy));
    const selected = chooseByOrder(eligible, policy.preferredOrder);

    if (selected) {
      return Object.freeze({
        ok: true,
        mode: "verified-path",
        selected,
        eligible: Object.freeze(eligible),
        rejected: Object.freeze(normalized.filter((candidate) => candidate !== selected && !eligible.includes(candidate))),
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

  function evaluateRegistry(registry) {
    if (!registry || typeof registry.list !== "function") {
      return evaluate([]);
    }
    return evaluate(registry.list());
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
