import { KernelCapabilityManifest } from "./kernel-capability-manifest.js";
import yaml from "js-yaml";

const SHARE_PROTOCOLS = /(?:^|\s)(vmess|vless|trojan|ss|hysteria2|hy2|tuic|anytls):\/\/[^\s\\]+/i;

function textOf(input) {
  return typeof input === "string" ? input.trim() : "";
}

function looksLikeYaml(text, key) {
  return new RegExp("(^|\\n)\\s*" + key + "\\s*:", "i").test(text);
}

function parseJson(text) {
  if (!text || !/^[\\[{]/.test(text)) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function decodeBase64(value) {
  const normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function parseStructured(text) {
  if (!text) return null;
  const json = parseJson(text);
  if (json) return json;
  try {
    const value = yaml.load(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function evidence(kernel, path, reason, weight) {
  return { kernel, path, reason, weight };
}

function protocolCandidates(protocol) {
  const normalized = protocol === "ss" ? "shadowsocks" : protocol === "hy2" ? "hysteria2" : protocol;
  return Object.keys(KernelCapabilityManifest).filter((kernel) => {
    const manifest = KernelCapabilityManifest[kernel];
    return manifest.protocols.includes(normalized) && !manifest.unsupported.includes(normalized);
  });
}

function schemaEvidence(input) {
  const items = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return items;

  if (Array.isArray(input.proxies)) {
    items.push(evidence("mihomo", "proxies", "top-level proxies array matches Clash/Mihomo configuration structure", 100));
  }
  if (Array.isArray(input.proxy_groups)) {
    items.push(evidence("mihomo", "proxy_groups", "top-level proxy_groups array is a Mihomo/Clash-style group field", 20));
  }

  if (Array.isArray(input.inbounds) && Array.isArray(input.outbounds)) {
    items.push(evidence("sing-box", "inbounds/outbounds", "both inbound and outbound collections are present", 30));
    items.push(evidence("xray", "inbounds/outbounds", "both inbound and outbound collections are present", 30));
  }

  if (input.route && typeof input.route === "object") {
    items.push(evidence("sing-box", "route", "top-level route object matches sing-box routing structure", 60));
  }
  if (input.dns && input.route && !input.routing) {
    items.push(evidence("sing-box", "dns+route", "DNS and route fields reinforce the sing-box schema", 10));
  }

  if (input.routing && typeof input.routing === "object") {
    items.push(evidence("xray", "routing", "top-level routing object matches Xray routing structure", 60));
  }
  if (input.log && input.routing && !input.route) {
    items.push(evidence("xray", "log+routing", "log plus routing reinforces the Xray schema", 10));
  }

  return items;
}

function fromEvidence(items, kind) {
  const scores = { mihomo: 0, "sing-box": 0, xray: 0 };
  for (const item of items) scores[item.kernel] += item.weight;

  const candidates = Object.keys(scores)
    .filter((kernel) => scores[kernel] > 0)
    .sort((a, b) => scores[b] - scores[a]);

  const bestScore = candidates.length ? scores[candidates[0]] : 0;
  const tied = candidates.filter((kernel) => scores[kernel] === bestScore);
  const kernel = bestScore > 0 && tied.length === 1 ? tied[0] : null;

  return {
    kind,
    kernel,
    candidates,
    confidence: kernel ? "schema-scored" : (tied.length > 1 ? "schema-ambiguous" : "none"),
    score: bestScore,
    evidence: items.filter((item) => !kernel || item.kernel === kernel || tied.includes(item.kernel))
  };
}

function unknownResult() {
  return { kind: "unknown", kernel: null, candidates: [], confidence: "none", score: 0, evidence: [] };
}

function sniffText(text, allowBase64) {
  const structured = parseStructured(text);
  if (structured !== null && Array.isArray(structured.proxies) && looksLikeYaml(text, "proxies")) {
    return {
      kind: "clash-yaml",
      kernel: "mihomo",
      candidates: ["mihomo"],
      confidence: "schema",
      score: 100,
      evidence: [evidence("mihomo", "proxies", "top-level proxies field identifies a Clash/Mihomo-style YAML configuration", 100)]
    };
  }

  if (structured !== null) {
    return fromEvidence(schemaEvidence(structured), parseJson(text) ? "json" : "structured");
  }

  const shareMatch = text.match(SHARE_PROTOCOLS);
  if (shareMatch) {
    const protocol = shareMatch[1].toLowerCase();
    const candidates = protocolCandidates(protocol);
    return {
      kind: "share-link",
      kernel: candidates.length === 1 ? candidates[0] : null,
      candidates,
      confidence: candidates.length === 1 ? "protocol-native" : "protocol-multi-runtime",
      score: candidates.length === 1 ? 100 : 50,
      protocol: protocol === "ss" ? "shadowsocks" : protocol === "hy2" ? "hysteria2" : protocol,
      evidence: [{
        kernel: null,
        path: "scheme",
        reason: "share link identifies the protocol; runtime selection is deferred to native compatibility resolution",
        weight: candidates.length === 1 ? 100 : 50
      }]
    };
  }

  if (allowBase64) {
    let decoded = "";
    try { decoded = decodeBase64(text).trim(); } catch {}
    if (decoded && decoded !== text) {
      const result = sniffText(decoded, false);
      if (result.kind !== "unknown") return result;
    }
  }

  return unknownResult();
}

export function sniff(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const result = fromEvidence(schemaEvidence(input), "structured");
    return result.kernel || result.candidates.length ? result : unknownResult();
  }
  return sniffText(textOf(input), true);
}
