export const CHAIN_SOURCE_TYPES = Object.freeze({
  NODE: "node",
  SUBSCRIPTION: "subscription",
  POLICY_GROUP: "policy-group",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") throw new TypeError("chain source must be an object");
  const id = text(source.id);
  const type = text(source.type);
  if (!id) throw new Error("chain source requires id");
  if (!Object.values(CHAIN_SOURCE_TYPES).includes(type)) throw new Error("unsupported chain source type: " + type);
  return Object.freeze({
    id,
    type,
    label: text(source.label) || id,
    enabled: source.enabled !== false,
    nodeIds: Object.freeze(Array.isArray(source.nodeIds) ? source.nodeIds.map(String).filter(Boolean) : []),
  });
}

function resolveSource(source, catalog) {
  const normalized = normalizeSource(source);
  const list = catalog[normalized.type];
  if (!Array.isArray(list)) throw new Error("chain source catalog is missing: " + normalized.type);
  const found = list.find((item) => item && String(item.id) === normalized.id);
  if (!found || found.enabled === false) throw new Error("chain source is unavailable: " + normalized.id);
  return Object.freeze({ ...normalized, source: found });
}

function normalizeHop(hop, index, catalog) {
  if (!hop || typeof hop !== "object") throw new TypeError("chain hop " + index + " is invalid");
  const source = hop.source || hop;
  return Object.freeze({
    index,
    id: text(hop.id) || "hop-" + (index + 1),
    source: resolveSource(source, catalog),
    kernel: text(hop.kernel) || null,
  });
}

export function createChainEditorModel({
  nodes = [],
  subscriptions = [],
  policyGroups = [],
  hops = [],
} = {}) {
  const catalog = {
    [CHAIN_SOURCE_TYPES.NODE]: nodes,
    [CHAIN_SOURCE_TYPES.SUBSCRIPTION]: subscriptions,
    [CHAIN_SOURCE_TYPES.POLICY_GROUP]: policyGroups,
  };

  if (!Array.isArray(hops) || hops.length < 2) {
    throw new Error("chain editor requires at least two ordered hops");
  }

  const normalizedHops = hops.map((hop, index) => normalizeHop(hop, index, catalog));
  const seen = new Set();
  for (const hop of normalizedHops) {
    const key = hop.source.type + ":" + hop.source.id;
    if (seen.has(key)) throw new Error("chain source cannot be reused in the same pipeline: " + key);
    seen.add(key);
  }

  return Object.freeze({
    version: 2,
    sourceCatalog: Object.freeze({
      nodes: Object.freeze(nodes.filter(Boolean)),
      subscriptions: Object.freeze(subscriptions.filter(Boolean)),
      policyGroups: Object.freeze(policyGroups.filter(Boolean)),
    }),
    hops: Object.freeze(normalizedHops),
    visual: Object.freeze({
      direction: "left-to-right",
      nodes: Object.freeze(normalizedHops.map((hop) => Object.freeze({
        id: hop.id,
        index: hop.index,
        sourceType: hop.source.type,
        sourceId: hop.source.id,
        label: hop.source.label,
        kernel: hop.kernel,
      }))),
      edges: Object.freeze(normalizedHops.slice(0, -1).map((hop, index) => Object.freeze({
        from: hop.id,
        to: normalizedHops[index + 1].id,
      }))),
    }),
  });
}

export function validateChainEditorSelection(model) {
  if (!model || !Array.isArray(model.hops)) {
    return Object.freeze({ valid: false, reason: "missing-chain-editor-hops" });
  }
  if (model.hops.length < 2) {
    return Object.freeze({ valid: false, reason: "at-least-two-hops-required" });
  }

  const ids = new Set();
  for (const hop of model.hops) {
    if (!hop || !hop.id || !hop.source) {
      return Object.freeze({ valid: false, reason: "invalid-chain-hop" });
    }
    if (ids.has(hop.id)) {
      return Object.freeze({ valid: false, reason: "duplicate-hop-id" });
    }
    ids.add(hop.id);
  }
  return Object.freeze({ valid: true });
}
