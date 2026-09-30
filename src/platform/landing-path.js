import { LANDING_ENDPOINT_TYPES, resolveLandingEndpoint } from "./landing-endpoints.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function endpointId(value) {
  return text(value && (value.id || value.uuid || value.name || value.server));
}

function resolvePathNode(nodes, id, role) {
  const wanted = text(id);
  if (!wanted) return null;
  const node = (Array.isArray(nodes) ? nodes : []).find((item) => endpointId(item) === wanted);
  if (!node) {
    return {
      type: "reject",
      target: "reject",
      reason: "missing-" + role + "-node",
      id: wanted,
    };
  }
  if (node.enabled === false) {
    return {
      type: "reject",
      target: "reject",
      reason: "disabled-" + role + "-node",
      id: wanted,
    };
  }
  return {
    type: "node",
    role,
    id: wanted,
    node,
  };
}

export function resolvePlatformChainPath({
  nodes = [],
  landingEndpoints = [],
  entryId,
  relayId = null,
  landingId,
  landingType = null,
} = {}) {
  const entry = resolvePathNode(nodes, entryId, "entry");
  if (!entry || entry.type === "reject") {
    return Object.freeze(entry || {
      type: "reject",
      target: "reject",
      reason: "missing-entry-node",
    });
  }

  const relay = relayId ? resolvePathNode(nodes, relayId, "relay") : null;
  if (relay && relay.type === "reject") return Object.freeze(relay);

  let landing;
  try {
    landing = resolveLandingEndpoint(landingEndpoints, {
      preferredId: landingId,
      preferredType: landingType,
    }).selected;
  } catch (error) {
    return Object.freeze({
      type: "reject",
      target: "reject",
      reason: "no-usable-landing-endpoint",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const hops = [entry];
  if (relay) hops.push(relay);
  hops.push({
    type: landing.type,
    role: "landing-exit",
    id: landing.id,
    endpoint: landing,
  });

  return Object.freeze({
    type: "chain",
    target: "chain",
    hops: Object.freeze(hops.map((hop) => Object.freeze(hop))),
    entry: Object.freeze(entry),
    relay: relay ? Object.freeze(relay) : null,
    landing: Object.freeze({
      id: landing.id,
      type: landing.type,
      endpoint: landing,
    }),
  });
}

export function isWarpLandingPath(path) {
  return Boolean(
    path &&
    path.type === "chain" &&
    path.landing &&
    path.landing.type === LANDING_ENDPOINT_TYPES.WARP,
  );
}
