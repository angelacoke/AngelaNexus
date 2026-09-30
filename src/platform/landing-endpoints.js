export const LANDING_ENDPOINT_TYPES = Object.freeze({
  NODE: "node",
  WARP: "warp",
});

export const WARP_TUNNEL_PROTOCOLS = Object.freeze({
  WIREGUARD: "wireguard",
  MASQUE: "masque",
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
      node: endpoint,
      execution: Object.freeze({ role: "landing-exit" }),
    }));
  }

  for (const endpoint of warp) {
    result.push(normalizeWarpEndpoint(endpoint));
  }

  return Object.freeze(result);
}

export function resolveLandingEndpoint(catalog, {
  preferredId = null,
  preferredType = null,
  requireEnabled = true,
} = {}) {
  const endpoints = Array.isArray(catalog) ? catalog : [];
  const candidates = endpoints.filter((endpoint) => {
    if (!endpoint || typeof endpoint !== "object") return false;
    if (requireEnabled && endpoint.enabled === false) return false;
    if (preferredType && endpoint.type !== preferredType) return false;
    return true;
  });

  if (preferredId) {
    const selected = candidates.find((endpoint) => endpoint.id === String(preferredId));
    if (!selected) throw new Error("no usable landing endpoint: " + preferredId);
    if (selected.type === LANDING_ENDPOINT_TYPES.WARP && !selected.credentialRef) {
      throw new Error("WARP landing endpoint has no secure credential reference: " + selected.id);
    }
    return Object.freeze({ selected, candidates: Object.freeze(candidates) });
  }

  if (!candidates.length) {
    throw new Error("no usable landing endpoint");
  }

  const selected = candidates[0];
  if (selected.type === LANDING_ENDPOINT_TYPES.WARP && !selected.credentialRef) {
    throw new Error("WARP landing endpoint has no secure credential reference: " + selected.id);
  }

  return Object.freeze({
    selected,
    candidates: Object.freeze(candidates),
  });
}
