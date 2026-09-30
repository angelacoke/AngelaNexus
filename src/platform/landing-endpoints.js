export const LANDING_ENDPOINT_TYPES = Object.freeze({
  NODE: "node",
  WARP: "warp",
});

export const WARP_TUNNEL_PROTOCOLS = Object.freeze({
  WIREGUARD: "wireguard",
  MASQUE: "masque",
});

export const LANDING_ENDPOINT_HEALTH = Object.freeze({
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
});

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("WARP endpoint " + field + " is required");
  }
  return value.trim();
}

function normalizeWarpEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") {
    throw new Error("WARP endpoint must be an object");
  }
  const id = requiredString(endpoint.id, "id");
  const protocol = String(endpoint.protocol || WARP_TUNNEL_PROTOCOLS.MASQUE).toLowerCase();
  if (!Object.values(WARP_TUNNEL_PROTOCOLS).includes(protocol)) {
    throw new Error("unsupported WARP tunnel protocol: " + protocol);
  }

  return Object.freeze({
    id,
    type: LANDING_ENDPOINT_TYPES.WARP,
    name: typeof endpoint.name === "string" && endpoint.name.trim() ? endpoint.name.trim() : id,
    protocol,
    enabled: endpoint.enabled !== false,
    credentialRef: endpoint.credentialRef ? String(endpoint.credentialRef) : null,
    health: endpoint.health || LANDING_ENDPOINT_HEALTH.UNKNOWN,
    execution: Object.freeze({
      role: "landing-exit",
      scope: "user",
      countryAffinity: "not-guaranteed",
    }),
  });
}

export function createLandingEndpointCatalog({ warp = [], nodes = [] } = {}) {
  const result = [];

  for (const endpoint of nodes) {
    if (!endpoint || typeof endpoint !== "object") continue;
    const id = String(endpoint.id || endpoint.uuid || endpoint.name || "").trim();
    if (!id) continue;
    result.push(Object.freeze({
      id,
      type: LANDING_ENDPOINT_TYPES.NODE,
      name: typeof endpoint.name === "string" && endpoint.name.trim() ? endpoint.name.trim() : id,
      enabled: endpoint.enabled !== false,
      health: endpoint.health || LANDING_ENDPOINT_HEALTH.UNKNOWN,
      node: endpoint,
      execution: Object.freeze({ role: "landing-exit" }),
    }));
  }

  for (const endpoint of warp) {
    result.push(normalizeWarpEndpoint(endpoint));
  }

  return Object.freeze(result);
}

function isUsable(endpoint, requireEnabled) {
  if (!endpoint || typeof endpoint !== "object") return false;
  if (requireEnabled && endpoint.enabled === false) return false;
  if (endpoint.health === LANDING_ENDPOINT_HEALTH.UNAVAILABLE) return false;
  if (endpoint.type === LANDING_ENDPOINT_TYPES.WARP && !endpoint.credentialRef) return false;
  return true;
}

function assertWarpCredential(endpoint) {
  if (endpoint.type === LANDING_ENDPOINT_TYPES.WARP && !endpoint.credentialRef) {
    throw new Error("WARP landing endpoint has no secure credential reference: " + endpoint.id);
  }
}

export function resolveLandingEndpoint(catalog, {
  preferredId = null,
  preferredType = null,
  requireEnabled = true,
} = {}) {
  const endpoints = Array.isArray(catalog) ? catalog : [];
  const candidates = endpoints.filter((endpoint) => {
    if (!isUsable(endpoint, requireEnabled)) return false;
    if (preferredType && endpoint.type !== preferredType) return false;
    return true;
  });

  if (preferredId) {
    const selected = candidates.find((endpoint) => endpoint.id === String(preferredId));
    if (!selected) throw new Error("no usable landing endpoint: " + preferredId);
    assertWarpCredential(selected);
    return Object.freeze({ selected, candidates: Object.freeze(candidates) });
  }

  if (!candidates.length) {
    throw new Error("no usable landing endpoint");
  }

  const selected = candidates[0];
  assertWarpCredential(selected);

  return Object.freeze({
    selected,
    candidates: Object.freeze(candidates),
  });
}

export function evaluateLandingEndpoint(endpoint, { reachable = null, reason = null } = {}) {
  if (!endpoint || typeof endpoint !== "object") {
    throw new Error("landing endpoint must be an object");
  }

  const health = reachable === true
    ? LANDING_ENDPOINT_HEALTH.AVAILABLE
    : reachable === false
      ? LANDING_ENDPOINT_HEALTH.UNAVAILABLE
      : (endpoint.health || LANDING_ENDPOINT_HEALTH.UNKNOWN);

  const available = health !== LANDING_ENDPOINT_HEALTH.UNAVAILABLE &&
    endpoint.enabled !== false &&
    !(endpoint.type === LANDING_ENDPOINT_TYPES.WARP && !endpoint.credentialRef);

  return Object.freeze({
    endpointId: endpoint.id,
    type: endpoint.type,
    health,
    available,
    userActionRequired: !available,
    reason: reason || (available ? null : "landing endpoint unavailable"),
  });
}

export function resolveLandingEndpointWithFallback(catalog, {
  preferredId = null,
  preferredType = null,
  requireEnabled = true,
} = {}) {
  try {
    return Object.freeze({
      ...resolveLandingEndpoint(catalog, { preferredId, preferredType, requireEnabled }),
      fallbackUsed: false,
      warning: null,
    });
  } catch (error) {
    const endpoints = Array.isArray(catalog) ? catalog : [];
    const alternatives = endpoints.filter((endpoint) => {
      if (preferredId && endpoint && endpoint.id === String(preferredId)) return false;
      if (preferredType && endpoint && endpoint.type !== preferredType) return false;
      return isUsable(endpoint, requireEnabled);
    });

    if (!alternatives.length) {
      throw new Error("no usable landing endpoint; direct connection is not an allowed fallback");
    }

    const selected = alternatives[0];
    assertWarpCredential(selected);
    return Object.freeze({
      selected,
      candidates: Object.freeze(alternatives),
      fallbackUsed: true,
      warning: error && error.message ? error.message : "preferred landing endpoint unavailable",
    });
  }
}
