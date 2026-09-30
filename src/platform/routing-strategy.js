const DEFAULT_PROXY = "secure-proxy";
const DEFAULT_DIRECT = "domestic-direct";
const DEFAULT_REJECT = "reject";

export const RoutingSemantics = Object.freeze({ PARALLEL: "parallel", FAIL_CLOSED: "fail-closed", SPECIFICITY_RESOLUTION: "specificity-resolution" });
export const RoutingCategories = Object.freeze(["local", "domestic", "ai", "meta-ai", "social", "messaging", "media", "developer", "cloud", "commerce", "productivity", "foreign", "unknown"]);

export const RoutingPolicyCatalog = Object.freeze([
  { id: "local-network", category: "local", label: "本地/局域网", defaultEnabled: true, securityCritical: true },
  { id: "domestic-domain", category: "domestic", label: "中国大陆域名保底", defaultEnabled: true, securityCritical: true },
  { id: "domestic-ip", category: "domestic", label: "中国大陆IP保底", defaultEnabled: true, securityCritical: true },
  { id: "domestic-banking", category: "domestic", label: "国内银行", defaultEnabled: true, securityCritical: true },
  { id: "domestic-government", category: "domestic", label: "国内政务", defaultEnabled: true, securityCritical: true },
  { id: "domestic-payment", category: "domestic", label: "国内支付", defaultEnabled: true, securityCritical: true },
  { id: "domestic-finance", category: "domestic", label: "国内金融", defaultEnabled: true, securityCritical: true },
  { id: "domestic-insurance", category: "domestic", label: "国内保险", defaultEnabled: true, securityCritical: true },
  { id: "domestic-social", category: "domestic", label: "国内主流社交", defaultEnabled: true, securityCritical: true },
  { id: "domestic-gaming", category: "domestic", label: "国内游戏", defaultEnabled: true, securityCritical: true },
  { id: "ai", category: "ai", label: "海外AI", defaultEnabled: true, securityCritical: true },
  { id: "meta-ai", category: "meta-ai", label: "Meta AI", defaultEnabled: true, securityCritical: true },
  { id: "social", category: "social", label: "海外社交", defaultEnabled: false },
  { id: "messaging", category: "messaging", label: "海外通讯", defaultEnabled: false },
  { id: "media", category: "media", label: "海外媒体/流媒体", defaultEnabled: false },
  { id: "developer", category: "developer", label: "海外开发者", defaultEnabled: false },
  { id: "cloud", category: "cloud", label: "海外云服务", defaultEnabled: false },
  { id: "commerce", category: "commerce", label: "海外电商", defaultEnabled: false },
  { id: "productivity", category: "productivity", label: "海外办公/生产力", defaultEnabled: false },
  { id: "foreign", category: "foreign", label: "其他海外流量", defaultEnabled: true, securityCritical: true },
  { id: "unknown-public", category: "unknown", label: "未知公网流量", defaultEnabled: true, securityCritical: true }
]);

function service(id, label, domains, packages = [], processNames = []) { return Object.freeze({ id, label, domains: Object.freeze(domains), packages: Object.freeze(packages), processNames: Object.freeze(processNames) }); }

export const GlobalServiceCatalog = Object.freeze({
  ai: Object.freeze([
    service("openai", "OpenAI / ChatGPT", ["openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com"]), service("anthropic", "Anthropic / Claude", ["anthropic.com", "claude.ai", "claude.com"]),
    service("google-gemini", "Google Gemini / AI Studio", ["gemini.google.com", "ai.google.dev", "aistudio.google.com"]), service("microsoft-copilot", "Microsoft Copilot", ["copilot.microsoft.com", "copilot.com"]),
    service("perplexity", "Perplexity", ["perplexity.ai"]), service("poe", "Poe", ["poe.com"]), service("character-ai", "Character.AI", ["character.ai"]),
    service("midjourney", "Midjourney", ["midjourney.com"]), service("huggingface", "Hugging Face", ["huggingface.co"]), service("replicate", "Replicate", ["replicate.com"]),
    service("cohere", "Cohere", ["cohere.com"]), service("mistral", "Mistral AI", ["mistral.ai", "chat.mistral.ai"]), service("groq", "Groq", ["groq.com"]),
    service("together", "Together AI", ["together.ai"]), service("deepmind", "Google DeepMind", ["deepmind.google"]), service("stability", "Stability AI", ["stability.ai"])
  ]),
  meta_ai: Object.freeze([
    service("meta-ai", "Meta AI", ["meta.ai"]), service("meta-ai-facebook", "Meta AI on Facebook", ["facebook.com"]), service("meta-ai-instagram", "Meta AI on Instagram", ["instagram.com"]),
    service("meta-ai-messenger", "Meta AI on Messenger", ["messenger.com"]), service("meta-ai-whatsapp", "Meta AI on WhatsApp", ["whatsapp.com"])
  ]),
  social: Object.freeze([
    service("x", "X", ["x.com", "twitter.com"]), service("facebook", "Facebook", ["facebook.com"]), service("instagram", "Instagram", ["instagram.com"]), service("threads", "Threads", ["threads.net"]),
    service("reddit", "Reddit", ["reddit.com", "redd.it"]), service("tiktok", "TikTok", ["tiktok.com", "tiktokcdn.com"]), service("linkedin", "LinkedIn", ["linkedin.com", "licdn.com"]),
    service("pinterest", "Pinterest", ["pinterest.com", "pinimg.com"]), service("tumblr", "Tumblr", ["tumblr.com"])
  ]),
  messaging: Object.freeze([
    service("telegram", "Telegram", ["telegram.org", "t.me", "telegram.me"]), service("discord", "Discord", ["discord.com", "discordapp.com", "discord.gg"]),
    service("whatsapp", "WhatsApp", ["whatsapp.com", "whatsapp.net"]), service("signal", "Signal", ["signal.org"]), service("line", "LINE", ["line.me"]),
    service("viber", "Viber", ["viber.com"]), service("messenger", "Messenger", ["messenger.com"]), service("skype", "Skype", ["skype.com"])
  ]),
  media: Object.freeze([
    service("youtube", "YouTube", ["youtube.com", "youtu.be", "googlevideo.com", "ytimg.com"]), service("netflix", "Netflix", ["netflix.com", "nflxvideo.net", "nflximg.net"]),
    service("spotify", "Spotify", ["spotify.com", "spotifycdn.com"]), service("twitch", "Twitch", ["twitch.tv", "ttvnw.net"]), service("prime-video", "Prime Video", ["primevideo.com", "amazonvideo.com"]),
    service("disney-plus", "Disney+", ["disneyplus.com"]), service("hulu", "Hulu", ["hulu.com"]), service("vimeo", "Vimeo", ["vimeo.com", "vimeocdn.com"]), service("soundcloud", "SoundCloud", ["soundcloud.com"])
  ]),
  developer: Object.freeze([
    service("github", "GitHub", ["github.com", "githubusercontent.com", "githubassets.com"]), service("gitlab", "GitLab", ["gitlab.com"]), service("bitbucket", "Bitbucket", ["bitbucket.org"]),
    service("npm", "npm", ["npmjs.com", "npmjs.org"]), service("pypi", "PyPI", ["pypi.org"]), service("docker", "Docker", ["docker.com", "docker.io"]),
    service("stackoverflow", "Stack Overflow", ["stackoverflow.com", "stackexchange.com"]), service("jetbrains", "JetBrains", ["jetbrains.com"]), service("codeberg", "Codeberg", ["codeberg.org"])
  ]),
  cloud: Object.freeze([
    service("cloudflare", "Cloudflare", ["cloudflare.com", "cloudflareclient.com"]), service("aws", "Amazon Web Services", ["aws.amazon.com", "amazonaws.com"]),
    service("azure", "Microsoft Azure", ["azure.com", "windows.net"]), service("google-cloud", "Google Cloud", ["cloud.google.com", "googleapis.com", "gstatic.com", "googleusercontent.com"]),
    service("oracle-cloud", "Oracle Cloud", ["oracle.com", "oraclecloud.com"]), service("digitalocean", "DigitalOcean", ["digitalocean.com"]), service("vercel", "Vercel", ["vercel.com"]), service("netlify", "Netlify", ["netlify.com"])
  ]),
  commerce: Object.freeze([
    service("amazon", "Amazon", ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.co.jp"]), service("ebay", "eBay", ["ebay.com"]), service("etsy", "Etsy", ["etsy.com"]),
    service("shopify", "Shopify", ["shopify.com", "myshopify.com"]), service("walmart", "Walmart", ["walmart.com"]), service("best-buy", "Best Buy", ["bestbuy.com"])
  ]),
  productivity: Object.freeze([
    service("google-workspace", "Google Workspace", ["docs.google.com", "drive.google.com", "sheets.google.com", "slides.google.com"]), service("microsoft-365", "Microsoft 365", ["office.com", "office365.com", "microsoft365.com", "onedrive.com"]),
    service("notion", "Notion", ["notion.so", "notion.site"]), service("slack", "Slack", ["slack.com"]), service("zoom", "Zoom", ["zoom.us"]), service("dropbox", "Dropbox", ["dropbox.com"]),
    service("figma", "Figma", ["figma.com"]), service("canva", "Canva", ["canva.com"])
  ])
});

export const DomesticServiceCatalog = Object.freeze({
  banking: Object.freeze([service("icbc", "工商银行", ["icbc.com.cn"]), service("ccb", "建设银行", ["ccb.com"]), service("abc", "农业银行", ["abchina.com"]), service("boc", "中国银行", ["boc.cn"]), service("cmb", "招商银行", ["cmbchina.com"]), service("psbc", "邮储银行", ["psbc.com"]), service("bankcomm", "交通银行", ["bankcomm.com"]), service("spdb", "浦发银行", ["spdb.com.cn"]), service("citic-bank", "中信银行", ["citicbank.com"]), service("cib", "兴业银行", ["cib.com.cn"])]),
  government: Object.freeze([service("gov-cn", "中国政府网", ["gov.cn"]), service("nhsa", "国家医保", ["nhsa.gov.cn"]), service("chinatax", "国家税务", ["chinatax.gov.cn"]), service("court", "中国法院", ["court.gov.cn"]), service("12306", "铁路12306", ["12306.cn"]), service("miit", "工信部", ["miit.gov.cn"])]),
  payment: Object.freeze([service("alipay", "支付宝", ["alipay.com", "alipayobjects.com"]), service("wechat-pay", "微信支付", ["pay.weixin.qq.com", "weixin.qq.com"]), service("unionpay", "云闪付/银联", ["unionpay.com", "95516.com"])]),
  finance: Object.freeze([service("eastmoney", "东方财富", ["eastmoney.com"]), service("xueqiu", "雪球", ["xueqiu.com"]), service("cnstock", "中国证券网", ["cnstock.com"]), service("jrj", "金融界", ["jrj.com.cn"])]),
  insurance: Object.freeze([service("picc", "中国人保", ["picc.com"]), service("pingan", "中国平安", ["pingan.com"]), service("cpic", "中国太保", ["cpic.com.cn"]), service("china-life", "中国人寿", ["chinalife.com.cn"])]),
  social: Object.freeze([service("wechat", "微信", ["weixin.qq.com", "wechat.com"]), service("qq", "QQ", ["qq.com"]), service("weibo", "微博", ["weibo.com"]), service("xiaohongshu", "小红书", ["xiaohongshu.com"]), service("douyin", "抖音", ["douyin.com", "douyincdn.com"]), service("zhihu", "知乎", ["zhihu.com"])]),
  gaming: Object.freeze([service("tencent-games", "腾讯游戏", ["tencent.com", "qq.com"]), service("netease-games", "网易游戏", ["163.com", "netease.com"]), service("bilibili-games", "哔哩哔哩游戏", ["bilibili.com"]), service("mi-game", "小米游戏", ["mi.com"])]),
  general: Object.freeze([service("baidu", "百度", ["baidu.com", "bdstatic.com"]), service("bilibili", "哔哩哔哩", ["bilibili.com", "bilivideo.com"]), service("taobao", "淘宝", ["taobao.com"]), service("tmall", "天猫", ["tmall.com"]), service("jd", "京东", ["jd.com"]), service("pinduoduo", "拼多多", ["pinduoduo.com"]), service("meituan", "美团", ["meituan.com"]), service("kuaishou", "快手", ["kuaishou.com"]), service("csdn", "CSDN", ["csdn.net"]), service("163", "网易", ["163.com"])])
});
export const DomesticServiceGroups = DomesticServiceCatalog;

const MATCH_WEIGHTS = Object.freeze({ package_name: 150, process_path: 145, process_name: 140, domain: 135, ip_cidr: 125, domain_suffix: 105, geosite: 95, geoip: 95, rule_set: 90, domain_keyword: 70, source_ip_cidr: 45, protocol: 35, network: 30, port: 25, source_port: 20, inbound: 15, interface: 10, logical: 1 });
function lower(value) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function asArray(value) { return Array.isArray(value) ? value : [value]; }
function domainMatches(contextDomain, ruleDomain, type) { const domain = lower(contextDomain); if (!domain) return false; return asArray(ruleDomain).some((candidate) => { const value = lower(candidate); if (type === "domain") return domain === value; if (type === "domain_suffix") return domain === value || domain.endsWith("." + value); if (type === "domain_keyword") return domain.includes(value); return false; }); }
function valueMatches(actual, expected) { const a = lower(actual); return asArray(expected).some((value) => lower(value) === a); }
function conditionMatches(type, expected, context) { switch (type) { case "domain": case "domain_suffix": case "domain_keyword": return domainMatches(context.domain, expected, type); case "process_name": case "process_path": case "package_name": case "inbound": case "interface": case "protocol": case "network": return valueMatches(context[type], expected); case "port": case "source_port": return asArray(expected).some((v) => Number(v) === Number(context[type])); case "geoip": case "geosite": case "rule_set": return asArray(context[type]).some((v) => asArray(expected).some((e) => valueMatches(v, e))); case "ip_cidr": case "source_ip_cidr": return asArray(context[type]).some((v) => asArray(expected).some((e) => lower(v) === lower(e))); case "logical": return typeof expected === "function" ? Boolean(expected(context)) : Boolean(expected); default: return false; } }
function ruleMatches(rule, context) { return Object.entries(rule.match || {}).every(([type, expected]) => conditionMatches(type, expected, context)); }
function specificity(rule) { return Object.entries(rule.match || {}).reduce((score, [type, value]) => score + (MATCH_WEIGHTS[type] || 0) + (Array.isArray(value) ? Math.min(value.length, 8) : 1), 0); }

export function createRoutingPolicyOptions(overrides = {}) {
  const result = {};
  for (const policy of RoutingPolicyCatalog) result[policy.id] = overrides[policy.id] === undefined ? policy.defaultEnabled : Boolean(overrides[policy.id]);
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) {
    const categoryPolicy = category === "meta_ai" ? "meta-ai" : category;
    for (const item of services) { const key = `service:${category}:${item.id}`; result[key] = overrides[key] === undefined ? Boolean(result[categoryPolicy]) : Boolean(overrides[key]); }
  }
  for (const [group, services] of Object.entries(DomesticServiceCatalog)) {
    const categoryPolicy = `domestic-${group}`;
    for (const item of services) { const key = `service:domestic:${group}:${item.id}`; result[key] = overrides[key] === undefined ? Boolean(result[categoryPolicy]) : Boolean(overrides[key]); }
  }
  for (const policy of RoutingPolicyCatalog.filter((item) => item.securityCritical)) if (!result[policy.id]) throw new Error(`security-critical routing policy cannot be disabled: ${policy.id}`);
  return Object.freeze(result);
}

export function evaluateParallelRouting(policy, context = {}) {
  const options = createRoutingPolicyOptions(policy?.options || {}); const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const candidates = rules.filter((rule) => rule && rule.enabled !== false).filter((rule) => options[rule.policyId] !== false).filter((rule) => ruleMatches(rule, context)).map((rule) => Object.freeze({ rule, specificity: specificity(rule) })).sort((a, b) => b.specificity - a.specificity || String(a.rule.id).localeCompare(String(b.rule.id)));
  const selected = candidates[0]?.rule || null;
  return Object.freeze({ semantics: RoutingSemantics.PARALLEL, matchedRuleIds: Object.freeze(candidates.map((item) => item.rule.id)), candidates: Object.freeze(candidates), selected, action: selected?.action || policy?.defaultAction || { type: "route", target: DEFAULT_PROXY } });
}

function serviceMatch(item) { const match = { domain_suffix: item.domains }; if (item.packages.length) match.package_name = item.packages; if (item.processNames.length) match.process_name = item.processNames; return match; }

export function createSecureRoutingBaseline({ proxyTarget = DEFAULT_PROXY, directTarget = DEFAULT_DIRECT, rejectTarget = DEFAULT_REJECT, options = {} } = {}) {
  const enabled = createRoutingPolicyOptions(options); const rules = []; let id = 0;
  const add = (policyId, name, match, action, metadata = {}) => { if (enabled[policyId] === false) return; rules.push({ id: `baseline-${++id}`, policyId, name, match, action, metadata: { source: "built-in-service-catalog", ...metadata } }); };
  add("local-network", "local-network", { geoip: ["private"] }, { type: "route", target: directTarget }, { category: "local" });
  for (const [group, services] of Object.entries(DomesticServiceCatalog)) for (const item of services) { const policyId = `domestic-${group}`; const servicePolicy = `service:domestic:${group}:${item.id}`; if (enabled[servicePolicy]) add(servicePolicy, item.label, serviceMatch(item), { type: "route", target: directTarget }, { category: "domestic", group, serviceId: item.id, serviceLabel: item.label, appWebGranular: true }); }
  add("domestic-domain", "domestic-domain-fallback", { geosite: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic", fallback: true });
  add("domestic-ip", "domestic-ip-fallback", { geoip: ["cn"] }, { type: "route", target: directTarget }, { category: "domestic", fallback: true });
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) { const categoryPolicy = category === "meta_ai" ? "meta-ai" : category; for (const item of services) { const servicePolicy = `service:${category}:${item.id}`; if (enabled[servicePolicy]) add(servicePolicy, item.label, serviceMatch(item), { type: "route", target: proxyTarget }, { category: categoryPolicy, serviceId: item.id, serviceLabel: item.label, appWebGranular: true }); } }
  add("foreign", "foreign-public-fallback", { rule_set: ["foreign-public"] }, { type: "route", target: proxyTarget }, { category: "foreign", fallback: true });
  return Object.freeze({ version: 4, semantics: RoutingSemantics.PARALLEL, options: enabled, rules: Object.freeze(rules), defaultAction: Object.freeze({ type: "route", target: proxyTarget }), security: Object.freeze({ foreignFailClosed: true, unknownPublicTraffic: "proxy", domainAndIpAreFallbackOnly: true }), rejectTarget });
}

export function compileParallelRoutingForKernel(policy, kernel) {
  const supported = new Set(["mihomo", "sing-box", "xray"]); if (!supported.has(kernel)) throw new Error(`unsupported routing kernel: ${kernel}`);
  const rules = [...(policy?.rules || [])].sort((a, b) => specificity(b) - specificity(a) || String(a.id).localeCompare(String(b.id)));
  return Object.freeze({ version: 4, kernel, semantics: RoutingSemantics.PARALLEL, evaluation: "platform-parallel-candidates-then-specificity", executionOnly: true, policyOwnedByPlatform: true, serviceGranular: true, rules: Object.freeze(rules), final: policy?.defaultAction || { type: "route", target: DEFAULT_PROXY } });
}
