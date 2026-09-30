export const REGION_SELECTION_MODES = Object.freeze({
  AUTO: "auto",
  MANUAL: "manual",
});

export const RegionIds = Object.freeze([
  "cn", "hk", "mo", "tw", "jp", "kr", "sg", "us", "ca", "gb", "de", "fr", "nl",
  "au", "in", "ru", "tr", "ae", "br", "unknown",
]);

const REGION_ALIASES = Object.freeze({
  cn: ["cn", "china", "中国", "大陆"],
  hk: ["hk", "hong kong", "香港"],
  mo: ["mo", "macau", "澳门"],
  tw: ["tw", "taiwan", "台湾"],
  jp: ["jp", "japan", "日本", "东京", "大阪"],
  kr: ["kr", "korea", "south korea", "韩国", "首尔"],
  sg: ["sg", "singapore", "新加坡"],
  us: ["us", "usa", "united states", "america", "美国"],
  ca: ["ca", "canada", "加拿大"],
  gb: ["gb", "uk", "united kingdom", "britain", "英国", "伦敦"],
  de: ["de", "germany", "德国"],
  fr: ["fr", "france", "法国"],
  nl: ["nl", "netherlands", "荷兰"],
  au: ["au", "australia", "澳大利亚"],
  in: ["in", "india", "印度"],
  ru: ["ru", "russia", "俄罗斯"],
  tr: ["tr", "turkey", "türkiye", "土耳其"],
  ae: ["ae", "uae", "united arab emirates", "阿联酋"],
  br: ["br", "brazil", "巴西"],
});

function textOf(node) {
  return [
    node && node.name, node && node.label, node && node.server, node && node.address,
    node && node.host, node && node.region, node && node.country,
    node && node.countryCode, node && node.location,
  ].filter((v) => typeof v === "string").join(" ").trim().toLowerCase();
}

function aliasMatches(text, alias) {
  const value = alias.toLowerCase();
  if (value.length > 2) return text.includes(value);
  return new RegExp("(^|[^a-z0-9])" + value.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, "\\\\function textOf(node) {
  return [
    node && node.name, node && node.label, node && node.server, node && node.address,
    node && node.host, node && node.region, node && node.country,
    node && node.countryCode, node && node.location,
  ].filter((v) => typeof v === "string").join(" ").trim().toLowerCase();
}

export function inferNodeRegion(node) {
  const text = textOf(node);
  if (!text) return "unknown";
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias.toLowerCase()))) return region;
  }
  return typeof (node && node.countryCode) === "string" && node.countryCode.length === 2
    ? node.countryCode.toLowerCase()
    : "unknown";
}") + "([^a-z0-9]|$)", "i").test(text);
}

export function inferNodeRegion(node) {
  const text = textOf(node);
  if (!text) return "unknown";
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some((alias) => aliasMatches(text, alias))) return region;
  }
  return typeof (node && node.countryCode) === "string" && node.countryCode.length === 2
    ? node.countryCode.toLowerCase()
    : "unknown";
}

function normalizedNodes(nodes) {
  return Array.isArray(nodes) ? nodes.filter((node) => node && typeof node === "object") : [];
}

function nodeId(node, index) {
  return String((node && (node.id || node.uuid || node.name || node.server)) || "node-" + (index + 1));
}

export function buildRegionGroups(nodes = [], { includeUnknown = false } = {}) {
  const groups = {};
  normalizedNodes(nodes).forEach((node, index) => {
    const region = inferNodeRegion(node);
    if (region === "unknown" && !includeUnknown) return;
    if (!groups[region]) groups[region] = [];
    groups[region].push(node);
  });

  return Object.freeze(Object.fromEntries(
    Object.entries(groups)
      .filter(([, members]) => members.length > 0)
      .map(([region, members]) => [region, Object.freeze(members.map((node, index) => Object.freeze({
        id: nodeId(node, index),
        node,
      })))])
  ));
}

export function createRegionSelectionGroups(nodes = [], {
  mode = REGION_SELECTION_MODES.AUTO,
  manualSelections = {},
  health = {},
  includeUnknown = false,
} = {}) {
  if (![REGION_SELECTION_MODES.AUTO, REGION_SELECTION_MODES.MANUAL].includes(mode)) {
    throw new Error("unsupported region selection mode: " + mode);
  }

  const regions = buildRegionGroups(nodes, { includeUnknown });
  const result = {};

  for (const [region, members] of Object.entries(regions)) {
    const manual = Array.isArray(manualSelections[region]) ? manualSelections[region].map(String) : [];
    const available = members;
    if (!available.length) continue;

    const ranked = [...available].sort((a, b) => {
      const ah = health[a.id] || {};
      const bh = health[b.id] || {};
      const failed = (ah.available === false ? 1 : 0) - (bh.available === false ? 1 : 0);
      if (failed !== 0) return failed;
      const al = Number.isFinite(Number(ah.latencyMs)) ? Number(ah.latencyMs) : Number.POSITIVE_INFINITY;
      const bl = Number.isFinite(Number(bh.latencyMs)) ? Number(bh.latencyMs) : Number.POSITIVE_INFINITY;
      return al - bl;
    });

    const validManual = manual.filter((id) => available.some((n) => n.id === id));
    result[region] = Object.freeze({
      region,
      nodes: Object.freeze(members),
      selection: Object.freeze({
        activeMode: mode,
        auto: Object.freeze({
          candidateNodeIds: Object.freeze(ranked.map((n) => n.id)),
          preferredNodeId: ranked[0].id,
        }),
        manual: Object.freeze({
          selectedNodeIds: Object.freeze(validManual),
        }),
      }),
    });
  }

  return Object.freeze(result);
}

function serviceEntries(serviceCatalog) {
  const entries = [];
  function visit(value, path) {
    if (Array.isArray(value)) {
      for (const service of value) {
        if (service && typeof service === "object" && typeof service.id === "string") {
          entries.push({ category: path.join(":"), service });
        }
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) visit(child, path.concat(key));
  }
  visit(serviceCatalog || {}, []);
  return entries;
}

export function createServiceNodeBindings(serviceCatalog, regionGroups, { defaults = {}, overrides = {} } = {}) {
  const bindings = {};
  for (const entry of serviceEntries(serviceCatalog)) {
    const category = entry.category;
    const service = entry.service;
    const serviceKey = "service:" + category + ":" + service.id;
    const configured = overrides[serviceKey] !== undefined ? overrides[serviceKey] : defaults[serviceKey];
    const config = configured && typeof configured === "object" && !Array.isArray(configured)
      ? configured
      : { nodeIds: configured };
    const candidates = Array.isArray(config.nodeIds)
      ? config.nodeIds.map(String)
      : config.nodeIds ? [String(config.nodeIds)] : [];
    const region = typeof config.region === "string" && config.region.trim() ? config.region.trim().toLowerCase() : null;
    const mode = config.mode === REGION_SELECTION_MODES.MANUAL || candidates.length
      ? REGION_SELECTION_MODES.MANUAL
      : REGION_SELECTION_MODES.AUTO;
    bindings[serviceKey] = Object.freeze({
      serviceKey,
      category,
      serviceId: service.id,
      selection: Object.freeze({
        mode,
        region,
        nodeIds: Object.freeze(candidates),
      }),
      availableRegions: Object.freeze(Object.keys(regionGroups || {}).filter((candidateRegion) =>
        (!region || candidateRegion === region) &&
        regionGroups[candidateRegion].nodes.some((node) => !candidates.length || candidates.includes(node.id))
      )),
    });
  }
  return Object.freeze(bindings);
}

export function resolveServiceNode(serviceKey, binding, regionGroups, { preferredRegion = null, health = {} } = {}) {
  if (!binding) throw new Error("unknown service node binding: " + serviceKey);
  const candidates = [];

  const targetRegion = preferredRegion || binding.selection.region || null;
  for (const region of Object.keys(regionGroups || {})) {
    if (targetRegion && region !== targetRegion) continue;
    for (const member of regionGroups[region].nodes) {
      if (!binding.selection.nodeIds.length || binding.selection.nodeIds.includes(member.id)) {
        candidates.push({ region, nodeId: member.id, node: member.node });
      }
    }
  }

  if (!candidates.length) throw new Error("no available node for service: " + serviceKey);

  const ranked = candidates.sort((a, b) => {
    const ah = health[a.nodeId] || health[a.node.id] || {};
    const bh = health[b.nodeId] || health[b.node.id] || {};
    const failed = (ah.available === false ? 1 : 0) - (bh.available === false ? 1 : 0);
    if (failed !== 0) return failed;
    const al = Number.isFinite(Number(ah.latencyMs)) ? Number(ah.latencyMs) : Number.POSITIVE_INFINITY;
    const bl = Number.isFinite(Number(bh.latencyMs)) ? Number(bh.latencyMs) : Number.POSITIVE_INFINITY;
    return al - bl;
  });

  return Object.freeze({
    serviceKey,
    region: ranked[0].region,
    node: ranked[0].node,
    selectionMode: binding.selection.mode,
    candidates: Object.freeze(ranked.map((item) => Object.freeze({
      region: item.region,
      nodeId: item.nodeId,
    }))),
  });
}
