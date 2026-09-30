const DEFAULT_PROXY = "secure-proxy";
const DEFAULT_DIRECT = "domestic-direct";
const DEFAULT_REJECT = "reject";

export const RoutingSemantics = Object.freeze({
  PARALLEL: "parallel",
  FAIL_CLOSED: "fail-closed",
  SPECIFICITY_RESOLUTION: "specificity-resolution"
});

export const RoutingCategories = Object.freeze([
  "local", "domestic", "ai", "social", "messaging", "media", "developer",
  "cloud", "commerce", "productivity", "foreign", "unknown"
]);

/**
 * The platform owns policy. Kernels are execution backends only: they receive
 * already-resolved traffic intents and emit traffic through their native node
 * formats. No kernel is allowed to own the user-facing policy catalog.
 */
export const RoutingPolicyCatalog = Object.freeze([
  { id: "local-network", category: "local", label: "本地/局域网", defaultEnabled: true, securityCritical: true },
  { id: "domestic-domain", category: "domestic", label: "中国大陆域名", defaultEnabled: true, securityCritical: true },
  { id: "domestic-ip", category: "domestic", label: "中国大陆IP", defaultEnabled: true, securityCritical: true },
  { id: "ai", category: "ai", label: "海外AI", defaultEnabled: true, securityCritical: true },
  { id: "meta-ai", category: "ai", label: "Meta AI", defaultEnabled: true, securityCritical: true },
  { id: "social", category: "social", label: "海外社交", defaultEnabled: false },
  { id: "messaging", category: "messaging", label: "海外通讯", defaultEnabled: false },
  { id: "media", category: "media", label: "海外媒体/流媒体", defaultEnabled: false },
  { id: "developer", category: "developer", label: "海外开发者服务", defaultEnabled: false },
  { id: "cloud", category: "cloud", label: "海外云服务", defaultEnabled: false },
  { id: "commerce", category: "commerce", label: "海外电商", defaultEnabled: false },
  { id: "productivity", category: "productivity", label: "海外办公/生产力", defaultEnabled: false },
  { id: "foreign", category: "foreign", label: "其他海外流量", defaultEnabled: true, securityCritical: true },
  { id: "unknown-public", category: "unknown", label: "未知公网流量", defaultEnabled: true, securityCritical: true }
]);

export const GlobalServiceCatalog = Object.freeze({
  ai: Object.freeze([
    "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
    "anthropic.com", "claude.ai", "claude.com", "gemini.google.com", "ai.google.dev",
    "aistudio.google.com", "copilot.microsoft.com", "perplexity.ai", "poe.com",
    "character.ai", "midjourney.com", "huggingface.co", "replicate.com", "cohere.com",
    "mistral.ai", "groq.com", "together.ai", "deepmind.google", "stability.ai"
  ]),
  meta_ai: Object.freeze([
    "meta.ai", "meta.com", "meta.com.ai", "metaai.com"
  ]),
  social: Object.freeze([
    "x.com", "twitter.com", "facebook.com", "instagram.com", "threads.net",
    "reddit.com", "tiktok.com", "linkedin.com", "pinterest.com", "tumblr.com"
  ]),
  messaging: Object.freeze([
    "telegram.org", "t.me", "discord.com", "discordapp.com", "whatsapp.com",
    "signal.org", "line.me", "viber.com", "messenger.com"
  ]),
  media: Object.freeze([
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "netflix.com",
    "nflxvideo.net", "spotify.com", "spotifycdn.com", "twitch.tv", "primevideo.com",
    "disneyplus.com", "hulu.com"
  ]),
  developer: Object.freeze([
    "github.com", "githubusercontent.com", "githubassets.com", "gitlab.com", "bitbucket.org",
    "npmjs.com", "npmjs.org", "pypi.org", "docker.com", "docker.io", "stackoverflow.com", "jetbrains.com"
  ]),
  cloud: Object.freeze([
    "cloudflare.com", "cloudflareclient.com", "aws.amazon.com", "amazonaws.com", "azure.com",
    "googleapis.com", "gstatic.com", "googleusercontent.com", "oracle.com", "digitalocean.com",
    "vercel.com", "netlify.com"
  ])
});

export const DomesticServiceCatalog = Object.freeze([
  "baidu.com", "bilibili.com", "qq.com", "weixin.qq.com", "wechat.com", "alipay.com",
  "taobao.com", "tmall.com", "jd.com", "pinduoduo.com", "meituan.com", "dianping.com",
  "douyin.com", "douban.com", "weibo.com", "zhihu.com", "xiaohongshu.com", "csdn.net",
  "163.com", "126.com", "sina.com.cn", "sohu.com", "kuaishou.com"
]);

const MATCH_WEIGHTS = Object.freeze({
  package_name: 120, process_path: 115, process_name: 110, domain: 105, ip_cidr: 100,
  domain_suffix: 90, geosite: 80, geoip: 80, rule_set: 75, domain_keyword: 60,
  source_ip_cidr: 40, protocol: 30, network: 25, port: 20, source_port: 15,
  inbound: 10, interface: 5, logical: 1
});

function lower(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function asArray(value) { return Array.isArray(value) ? value : [value]; }
function domainMatches(contextDomain, ruleDomain, type) {
  const domain = lower(contextDomain);
  if (!domain) return false;
  return asArray(ruleDomain).some((candidate) => {
    const value = lower(candidate);
    if (type === "domain") return domain === value;
    if (type === "domain_suffix") return domain === value || domain.endsWith("." + value);
    if (type === "domain_keyword") return domain.includes(value);
    return false;
  });
}
function valueMatches(actual, expected) {
  const a = lower(actual);
  return asArray(expected).some((value) => lower(value) === a);
}
function conditionMatches(type, expected, context) {
  switch (type) {
    case "domain": case "domain_suffix": case "domain_keyword": return domainMatches(context.domain, expected, type);
    case "process_name": case "process_path": case "package_name": case "inbound": case "interface": case "protocol": case "network": return valueMatches(context[type], expected);
    case "port": case "source_port": return asArray(expected).some((v) => Number(v) === Number(context[type]));
    case "geoip": case "geosite": case "rule_set": return asArray(context[type]).some((v) => asArray(expected).some((e) => valueMatches(v, e)));
    case "ip_cidr": case "source_ip_cidr": return asArray(context[type]).some((v) => asArray(expected).some((e) => lower(v) === lower(e)));
    case "logical": return typeof expected === "function" ? Boolean(expected(context)) : Boolean(expected);
    default: return false;
  }
}
function ruleMatches(rule, context) { return Object.entries(rule.match || {}).every(([type, expected]) => conditionMatches(type, expected, context)); }
function specificity(rule) {
  return Object.entries(rule.match || {}).reduce((score, [type, value]) => score + (MATCH_WEIGHTS[type] || 0) + (Array.isArray(value) ? Math.min(value.length, 8) : 1), 0);
}

/** User switches. Security-critical policies cannot be disabled into DIRECT fallback. */
export function createRoutingPolicyOptions(overrides = {}) {
  const result = {};
  for (const policy of RoutingPolicyCatalog) {
    result[policy.id] = overrides[policy.id] === undefined ? policy.defaultEnabled : Boolean(overrides[policy.id]);
  }
  for (const policy of RoutingPolicyCatalog.filter((item) => item.securityCritical)) {
    if (!result[policy.id]) throw new Error(`security-critical routing policy cannot be disabled: ${policy.id}`);
  }
  return Object.freeze(result);
}

export function evaluateParallelRouting(policy, context = {}) {
  const options = createRoutingPolicyOptions(policy?.options || {});
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const candidates = rules.filter((rule) => rule && rule.enabled !== false)
    .filter((rule) => options[rule.policyId] !== false)
    .filter((rule) => ruleMatches(rule, context))
    .map((rule) => Object.freeze({ rule, specificity: specificity(rule) }))
    .sort((a, b) => b.specificity - a.specificity || String(a.rule.id).localeCompare(String(b.rule.id)));
  const selected = candidates[0]?.rule || null;
  return Object.freeze({
    semantics: RoutingSemantics.PARALLEL,
    matchedRuleIds: Object.freeze(candidates.map((item) => item.rule.id)),
    candidates: Object.freeze(candidates),
    selected,
    action: selected?.action || policy?.defaultAction || { type: "route", target: DEFAULT_PROXY }
  });
}

export function createSecureRoutingBaseline({ proxyTarget = DEFAULT_PROXY, directTarget = DEFAULT_DIRECT, rejectTarget = DEFAULT_REJECT, options = {} } = {}) {
  const enabled = createRoutingPolicyOptions(options);
  const rules = [];
  let id = 0;
  const add = (policyId, name, match, action, metadata = {}) => {
    if (enabled[policyId] === false) return;
    rules.push({ id: `baseline-${++id}`, policyId, name, match, action, metadata: { source: "built-in-baseline", ...metadata } });
  };
  add("local-network", "local-network", { geoip: ["private"] }, { type: "route", target: directTarget }, { category: "local" });
  add("domestic-domain", "domestic-domain", { geosite: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic" });
  add("domestic-ip", "domestic-ip", { geoip: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic" });
  for (const [category, domains] of Object.entries(GlobalServiceCatalog)) {
    const policyId = category === "meta_ai" ? "meta-ai" : category;
    add(policyId, `${category}-services`, { domain_suffix: domains }, { type: "route", target: proxyTarget }, { category });
  }
  add("domestic-domain", "domestic-services", { domain_suffix: DomesticServiceCatalog }, { type: "route", target: directTarget }, { category: "domestic" });
  add("foreign", "foreign-public", { rule_set: ["foreign-public"] }, { type: "route", target: proxyTarget }, { category: "foreign" });
  return Object.freeze({
    version: 2,
    semantics: RoutingSemantics.PARALLEL,
    options: enabled,
    rules: Object.freeze(rules),
    defaultAction: Object.freeze({ type: "route", target: proxyTarget }),
    security: Object.freeze({ foreignFailClosed: true, unknownPublicTraffic: "proxy" }),
    rejectTarget
  });
}

/**
 * Compiles platform policy into a kernel execution plan. The kernel receives no
 * policy catalog or UI switches; it only executes the selected traffic intent
 * through its native node/configuration format.
 */
export function compileParallelRoutingForKernel(policy, kernel) {
  const supported = new Set(["mihomo", "sing-box", "xray"]);
  if (!supported.has(kernel)) throw new Error(`unsupported routing kernel: ${kernel}`);
  const rules = [...(policy?.rules || [])].sort((a, b) => specificity(b) - specificity(a) || String(a.id).localeCompare(String(b.id)));
  return Object.freeze({
    version: 2,
    kernel,
    semantics: RoutingSemantics.PARALLEL,
    evaluation: "platform-parallel-candidates-then-specificity",
    executionOnly: true,
    policyOwnedByPlatform: true,
    rules: Object.freeze(rules),
    final: policy?.defaultAction || { type: "route", target: DEFAULT_PROXY }
  });
}
