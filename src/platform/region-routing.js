export const REGION_SELECTION_MODES = Object.freeze({
  AUTO: "auto",
  MANUAL: "manual",
});

export const RegionIds = Object.freeze([
  "cn", "hk", "mo", "tw",
  "jp", "kr", "sg", "my", "th", "vn", "id", "ph", "kh", "la", "mm",
  "in", "au", "nz",
  "us", "ca", "mx",
  "br", "ar", "cl", "co", "pe",
  "gb", "ie", "fr", "de", "nl", "be", "lu", "ch", "at", "es", "pt", "it",
  "pl", "cz", "sk", "hu", "ro", "bg", "gr", "se", "no", "dk", "fi", "is",
  "ua", "ru", "tr",
  "ae", "sa", "il", "eg", "za", "ng", "ke",
  "pk", "bd", "lk", "kz",
  "unknown",
]);

const REGION_ALIASES = Object.freeze({
  cn: ["cn", "china", "mainland china", "中国", "中国大陆", "大陆"],
  hk: ["hk", "hong kong", "香港"],
  mo: ["mo", "macau", "macao", "澳门"],
  tw: ["tw", "taiwan", "台湾"],
  jp: ["jp", "japan", "日本", "东京", "大阪"],
  kr: ["kr", "korea", "south korea", "republic of korea", "韩国", "南韩", "首尔"],
  sg: ["sg", "singapore", "新加坡"],
  my: ["my", "malaysia", "马来西亚", "吉隆坡"],
  th: ["th", "thailand", "泰国", "曼谷"],
  vn: ["vn", "vietnam", "越南", "河内", "胡志明市"],
  id: ["id", "indonesia", "印度尼西亚", "雅加达"],
  ph: ["ph", "philippines", "菲律宾", "马尼拉"],
  kh: ["kh", "cambodia", "柬埔寨"],
  la: ["la", "laos", "老挝"],
  mm: ["mm", "myanmar", "缅甸"],
  in: ["in", "india", "印度", "孟买", "新德里"],
  au: ["au", "australia", "澳大利亚", "悉尼", "墨尔本"],
  nz: ["nz", "new zealand", "新西兰", "奥克兰"],
  us: ["us", "usa", "united states", "united states of america", "america", "美国", "纽约", "洛杉矶", "西雅图", "旧金山"],
  ca: ["ca", "canada", "加拿大", "多伦多", "温哥华"],
  mx: ["mx", "mexico", "墨西哥"],
  br: ["br", "brazil", "巴西"],
  ar: ["ar", "argentina", "阿根廷"],
  cl: ["cl", "chile", "智利"],
  co: ["co", "colombia", "哥伦比亚"],
  pe: ["pe", "peru", "秘鲁"],
  gb: ["gb", "uk", "united kingdom", "great britain", "britain", "england", "英国", "伦敦"],
  ie: ["ie", "ireland", "爱尔兰", "都柏林"],
  fr: ["fr", "france", "法国", "巴黎"],
  de: ["de", "germany", "德国", "柏林", "法兰克福"],
  nl: ["nl", "netherlands", "holland", "荷兰", "阿姆斯特丹"],
  be: ["be", "belgium", "比利时", "布鲁塞尔"],
  lu: ["lu", "luxembourg", "卢森堡"],
  ch: ["ch", "switzerland", "瑞士", "苏黎世"],
  at: ["at", "austria", "奥地利", "维也纳"],
  es: ["es", "spain", "西班牙", "马德里", "巴塞罗那"],
  pt: ["pt", "portugal", "葡萄牙", "里斯本"],
  it: ["it", "italy", "意大利", "罗马", "米兰"],
  pl: ["pl", "poland", "波兰", "华沙"],
  cz: ["cz", "czech republic", "czechia", "捷克", "布拉格"],
  sk: ["sk", "slovakia", "斯洛伐克"],
  hu: ["hu", "hungary", "匈牙利", "布达佩斯"],
  ro: ["ro", "romania", "罗马尼亚", "布加勒斯特"],
  bg: ["bg", "bulgaria", "保加利亚", "索非亚"],
  gr: ["gr", "greece", "希腊", "雅典"],
  se: ["se", "sweden", "瑞典", "斯德哥尔摩"],
  no: ["no", "norway", "挪威", "奥斯陆"],
  dk: ["dk", "denmark", "丹麦", "哥本哈根"],
  fi: ["fi", "finland", "芬兰", "赫尔辛基"],
  is: ["is", "iceland", "冰岛", "雷克雅未克"],
  ua: ["ua", "ukraine", "乌克兰", "基辅"],
  ru: ["ru", "russia", "russian federation", "俄罗斯", "莫斯科"],
  tr: ["tr", "turkey", "türkiye", "土耳其", "伊斯坦布尔"],
  ae: ["ae", "uae", "united arab emirates", "阿联酋", "迪拜", "阿布扎比"],
  sa: ["sa", "saudi arabia", "沙特", "沙特阿拉伯", "利雅得"],
  il: ["il", "israel", "以色列", "特拉维夫"],
  eg: ["eg", "egypt", "埃及", "开罗"],
  za: ["za", "south africa", "南非", "约翰内斯堡", "开普敦"],
  ng: ["ng", "nigeria", "尼日利亚", "拉各斯"],
  ke: ["ke", "kenya", "肯尼亚", "内罗毕"],
  pk: ["pk", "pakistan", "巴基斯坦", "伊斯兰堡", "卡拉奇"],
  bd: ["bd", "bangladesh", "孟加拉国", "达卡"],
  lk: ["lk", "sri lanka", "斯里兰卡", "科伦坡"],
  kz: ["kz", "kazakhstan", "哈萨克斯坦", "阿拉木图"],
});

function textOf(node) {
  return [
    node && node.name,
    node && node.label,
    node && node.server,
    node && node.address,
    node && node.host,
    node && node.region,
    node && node.country,
    node && node.countryCode,
    node && node.location,
  ].filter((v) => typeof v === "string").join(" ").trim().toLowerCase();
}

function aliasMatches(text, alias) {
  const value = alias.toLowerCase();
  if (value.length > 2) return text.includes(value);
  const escaped = value.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, "\\\\$&");
  return new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)", "i").test(text);
}

export function inferNodeRegion(node) {
  const text = textOf(node);
  if (!text) return "unknown";
  for (const region of RegionIds) {
    const aliases = REGION_ALIASES[region];
    if (aliases && aliases.some((alias) => aliasMatches(text, alias))) return region;
  }
  const code = node && node.countryCode;
  if (typeof code === "string" && /^[a-zA-Z]{2}$/.test(code)) {
    const normalized = code.toLowerCase();
    if (RegionIds.includes(normalized)) return normalized;
  }
  return "unknown";
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
    const ranked = [...members].sort((a, b) => {
      const ah = health[a.id] || {};
      const bh = health[b.id] || {};
      const failed = (ah.available === false ? 1 : 0) - (bh.available === false ? 1 : 0);
      if (failed !== 0) return failed;
      const al = Number.isFinite(Number(ah.latencyMs)) ? Number(ah.latencyMs) : Number.POSITIVE_INFINITY;
      const bl = Number.isFinite(Number(bh.latencyMs)) ? Number(bh.latencyMs) : Number.POSITIVE_INFINITY;
      return al - bl;
    });
    const validManual = manual.filter((id) => members.some((n) => n.id === id));

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
