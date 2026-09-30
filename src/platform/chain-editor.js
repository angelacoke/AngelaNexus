export const CHAIN_SOURCE_TYPES = Object.freeze({
  NODE: "node",
  SUBSCRIPTION: "subscription",
  POLICY_GROUP: "policy-group",
});

export const CHAIN_ROLES = Object.freeze({
  ENTRY: "entry",
  RELAY: "relay",
  EXIT: "exit",
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

export function createChainEditorModel({
  nodes = [],
  subscriptions = [],
  policyGroups = [],
  entry = null,
  relay = null,
  exit = null,
} = {}) {
  const catalog = {
    [CHAIN_SOURCE_TYPES.NODE]: nodes,
    [CHAIN_SOURCE_TYPES.SUBSCRIPTION]: subscriptions,
    [CHAIN_SOURCE_TYPES.POLICY_GROUP]: policyGroups,
  };

  const selections = Object.freeze({
    entry: entry ? resolveSource(entry, catalog) : null,
    relay: relay ? resolveSource(relay, catalog) : null,
    exit: exit ? resolveSource(exit, catalog) : null,
  });

  if (!selections.entry || !selections.exit) {
    throw new Error("chain editor requires an entry and an exit selection");
  }

  const roles = [
    Object.freeze({ role: CHAIN_ROLES.ENTRY, selection: selections.entry }),
  ];
  if (selections.relay) roles.push(Object.freeze({ role: CHAIN_ROLES.RELAY, selection: selections.relay }));
  roles.push(Object.freeze({ role: CHAIN_ROLES.EXIT, selection: selections.exit }));

  return Object.freeze({
    version: 1,
    sourceCatalog: Object.freeze({
      nodes: Object.freeze(nodes.filter(Boolean)),
      subscriptions: Object.freeze(subscriptions.filter(Boolean)),
      policyGroups: Object.freeze(policyGroups.filter(Boolean)),
    }),
    selections,
    visual: Object.freeze({
      direction: "left-to-right",
      roles: Object.freeze(roles),
      edges: Object.freeze(roles.slice(0, -1).map((item, index) => Object.freeze({
        fromRole: item.role,
        toRole: roles[index + 1].role,
      }))),
    }),
  });
}

export function validateChainEditorSelection(model) {
  if (!model || !model.selections) return Object.freeze({ valid: false, reason: "missing-chain-editor-model" });
  const { entry, relay, exit } = model.selections;
  if (!entry || !exit) return Object.freeze({ valid: false, reason: "entry-and-exit-required" });
  if (entry.id === exit.id && entry.type === exit.type) return Object.freeze({ valid: false, reason: "entry-and-exit-must-differ" });
  if (relay && relay.id === entry.id && relay.type === entry.type) return Object.freeze({ valid: false, reason: "relay-cannot-equal-entry" });
  if (relay && relay.id === exit.id && relay.type === exit.type) return Object.freeze({ valid: false, reason: "relay-cannot-equal-exit" });
  return Object.freeze({ valid: true });
}
