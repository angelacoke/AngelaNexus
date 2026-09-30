const DEFAULT_PROXY = "secure-proxy";
const DEFAULT_DIRECT = "domestic-direct";
const DEFAULT_REJECT = "reject";

export const RoutingSemantics = Object.freeze({
  PARALLEL: "parallel",
  FAIL_CLOSED: "fail-closed",
  SPECIFICITY_RESOLUTION: "specificity-resolution"
});

export const RoutingCategories = Object.freeze([
  "local",
  "domestic",
  "ai",
  "social",
  "messaging",
  "media",
  "developer",
  "cloud",
  "commerce",
  "productivity",
  "foreign",
  "unknown"
]);

// High-value service domains are data, not routing precedence. All candidates
// are evaluated together; the resolver selects the most specific matching set.
export const GlobalServiceCatalog = Object.freeze({
  ai: Object.freeze([
    "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
    "anthropic.com", "claude.ai", "claude.com",
    "gemini.google.com", "ai.google.dev", "aistudio.google.com",
    "copilot.microsoft.com", "microsoft.com", "perplexity.ai",
    "poe.com", "character.ai", "midjourney.com", "huggingface.co",
    "replicate.com", "cohere.com", "mistral.ai", "groq.com",
    "together.ai", "deepmind.google", "stability.ai"
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
    "youtube.com", "youtu.be", "googlevideo.com", "ytimg.com",
    "netflix.com", "nflxvideo.net", "spotify.com", "spotifycdn.com",
    "twitch.tv", "primevideo.com", "disneyplus.com", "hulu.com"
  ]),
  developer: Object.freeze([
    "github.com", "githubusercontent.com", "githubassets.com", "gitlab.com",
    "bitbucket.org", "npmjs.com", "npmjs.org", "pypi.org", "docker.com",
    "docker.io", "stackoverflow.com", "jetbrains.com"
  ]),
  cloud: Object.freeze([
    "cloudflare.com", "cloudflareclient.com", "aws.amazon.com", "amazonaws.com",
    "azure.com", "googleapis.com", "gstatic.com", "googleusercontent.com",
    "oracle.com", "digitalocean.com", "vercel.com", "netlify.com"
  ])
});

export const DomesticServiceCatalog = Object.freeze([
  "baidu.com", "bilibili.com", "qq.com", "weixin.qq.com", "wechat.com",
  "alipay.com", "taobao.com", "tmall.com", "jd.com", "pinduoduo.com",
  "meituan.com", "dianping.com", "douyin.com", "douban.com", "weibo.com",
  "zhihu.com", "xiaohongshu.com", "csdn.net", "163.com", "126.com",
  "sina.com.cn", "sohu.com", "qq.com", "kuaishou.com"
]);

const MATCH_WEIGHTS = Object.freeze({
  package_name: 120,
  process_path: 115,
  process_name: 110,
  domain: 105,
  ip_cidr: 100,
  domain_suffix: 90,
  geosite: 80,
  geoip: 80,
  rule_set: 75,
  domain_keyword: 60,
  source_ip_cidr: 40,
  protocol: 30,
  network: 25,
  port: 20,
  source_port: 15,
  inbound: 10,
  interface: 5,
  logical: 1
});

function lower(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

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
    case "domain":
    case "domain_suffix":
    case "domain_keyword":
      return domainMatches(context.domain, expected, type);
    case "process_name":
    case "process_path":
    case "package_name":
    case "inbound":
    case "interface":
    case "protocol":
    case "network":
      return valueMatches(context[type], expected);
    case "port":
    case "source_port":
      return asArray(expected).some((v) => Number(v) === Number(context[type]));
    case "geoip":
      return valueMatches(context.geoip, expected);
    case "geosite":
      return asArray(context.geosite).some((v) => valueMatches(v, expected));
    case "rule_set":
      return asArray(context.rule_set).some((v) => valueMatches(v, expected));
    case "ip_cidr":
    case "source_ip_cidr":
      return asArray(context[type]).some((v) => asArray(expected).some((e) => lower(v) === lower(e)));
    case "logical":
      return typeof expected === "function" ? Boolean(expected(context)) : Boolean(expected);
    default:
      return false;
  }
}

function ruleMatches(rule, context) {
  return Object.entries(rule.match || {}).every(([type, expected]) => conditionMatches(type, expected, context));
}

function specificity(rule) {
  return Object.entries(rule.match || {}).reduce((score, [type, value]) => {
    const cardinality = Array.isArray(value) ? Math.min(value.length, 8) : 1;
    return score + (MATCH_WEIGHTS[type] || 0) + cardinality;
  }, 0);
}

export function evaluateParallelRouting(policy, context = {}) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const candidates = rules
    .filter((rule) => rule && rule.enabled !== false)
    .filter((rule) => ruleMatches(rule, context))
    .map((rule) => Object.freeze({
      rule,
      specificity: specificity(rule)
    }))
    .sort((a, b) => b.specificity - a.specificity || String(a.rule.id).localeCompare(String(b.rule.id)));

  const selected = candidates[0]?.rule || null;
  return Object.freeze({
    semantics: RoutingSemantics.PARALLEL,
    matchedRuleIds: Object.freeze(candidates.map((item) => item.rule.id)),
    candidates: Object.freeze(candidates),
    selected,
    action: selected?.action || policy?.defaultAction || { type: "reject", target: DEFAULT_REJECT }
  });
}

export function createSecureRoutingBaseline({
  proxyTarget = DEFAULT_PROXY,
  directTarget = DEFAULT_DIRECT,
  rejectTarget = DEFAULT_REJECT
} = {}) {
  const rules = [];
  let id = 0;
  const add = (name, match, action, metadata = {}) => rules.push({
    id: `baseline-${++id}`,
    name,
    match,
    action,
    metadata: { source: "built-in-baseline", ...metadata }
  });

  add("local-network", { geoip: ["private"] }, { type: "route", target: directTarget }, { category: "local" });
  add("domestic-domain", { geosite: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic" });
  add("domestic-ip", { geoip: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic" });

  for (const [category, domains] of Object.entries(GlobalServiceCatalog)) {
    add(`${category}-services`, { domain_suffix: domains }, { type: "route", target: proxyTarget }, { category });
  }
  add("domestic-services", { domain_suffix: DomesticServiceCatalog }, { type: "route", target: directTarget }, { category: "domestic" });

  // Unknown public destinations intentionally do not fall back to DIRECT.
  // A kernel adapter must translate this into its final catch-all proxy rule.
  return Object.freeze({
    version: 1,
    semantics: RoutingSemantics.PARALLEL,
    rules: Object.freeze(rules),
    defaultAction: Object.freeze({ type: "route", target: proxyTarget }),
    security: Object.freeze({ foreignFailClosed: true, unknownPublicTraffic: "proxy" }),
    rejectTarget
  });
}

export function compileParallelRoutingForKernel(policy, kernel) {
  const supported = new Set(["mihomo", "sing-box", "xray"]);
  if (!supported.has(kernel)) throw new Error(`unsupported routing kernel: ${kernel}`);

  const rules = [...(policy?.rules || [])]
    .filter((rule) => rule && rule.enabled !== false)
    .sort((a, b) => specificity(b) - specificity(a) || String(a.id).localeCompare(String(b.id)));

  return Object.freeze({
    version: 1,
    kernel,
    semantics: RoutingSemantics.PARALLEL,
    evaluation: "parallel-candidates-then-specificity",
    rules: Object.freeze(rules),
    final: policy?.defaultAction || { type: "route", target: DEFAULT_PROXY }
  });
}
