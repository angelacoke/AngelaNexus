import yaml from "js-yaml";
import { normalizeNodeConfig } from "./config.js";

const SHARE_PROTOCOLS = "(?:vmess|vless|trojan|ss|hysteria2|hy2|tuic|anytls)";
const SHARE_LINK_RE = new RegExp(SHARE_PROTOCOLS + "://[^\\s\\\\]+", "gi");
const MAX_REDIRECTS = 5;

function decodeBase64(value) {
  const normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeComponent(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function queryList(value) {
  return value ? value.split(",").map((item) => decodeComponent(item).trim()).filter(Boolean) : [];
}

function applyLinkOptions(node, params) {
  const security = params.get("security");
  const sni = params.get("sni") || params.get("servername") || params.get("serverName");
  const fp = params.get("fp") || params.get("fingerprint");
  const alpn = queryList(params.get("alpn"));
  if (fp) node.fingerprint = fp;
  if (security === "tls" || security === "reality" || sni || fp || alpn.length || params.get("allowInsecure") === "1") {
    node.tls = { enabled: security === "tls" || security === "reality" || Boolean(sni || fp || alpn.length), serverName: sni || undefined, fingerprint: fp || undefined, alpn };
    if (params.get("allowInsecure") === "1" || params.get("insecure") === "1") node.tls.insecure = true;
    if (security === "reality") node.tls.reality = { enabled: true, publicKey: params.get("pbk") || undefined, shortId: params.get("sid") || undefined, spiderX: params.get("spx") || undefined };
  }
  const network = params.get("type") || params.get("net") || params.get("network");
  if (network) {
    if (params.get("serviceName")) node.serviceName = params.get("serviceName");
    node.transport = { type: network, path: params.get("path") || undefined, serviceName: params.get("serviceName") || undefined };
    const host = params.get("host");
    if (host) node.transport.headers = { Host: host };
  }
  return node;
}

function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseShareLink(link) {
  const url = new URL(link);
  const protocol = url.protocol.slice(0, -1).toLowerCase();
  if (protocol === "vmess") {
    let payload;
    try { payload = JSON.parse(decodeBase64(url.hostname + url.pathname)); } catch { payload = null; }
    if (payload && typeof payload === "object") {
      const node = { id: "share-" + fingerprint(link), name: decodeComponent(url.hash.slice(1)) || payload.ps || "vmess", kind: "node", protocol: "vmess", server: payload.add, port: Number(payload.port), uuid: payload.id, username: payload.id, source: "share-link" };
      if (payload.aid !== undefined) node.alterId = payload.aid;
      if (payload.scy) node.security = payload.scy;
      const params = new URL("vmess://configuration").searchParams;
      if (payload.tls) params.set("security", payload.tls === "reality" ? "reality" : "tls");
      for (const key of ["sni", "fp", "net", "path", "host", "alpn"]) if (payload[key]) params.set(key, Array.isArray(payload[key]) ? payload[key].join(",") : payload[key]);
      if (payload.net === "grpc" && payload.path) params.set("serviceName", payload.path);
      return applyLinkOptions(node, params);
    }
  }
  if (protocol === "ss") {
    let user = decodeComponent(url.username || url.hostname), host = url.username ? url.hostname : undefined, port = url.port ? Number(url.port) : undefined;
    if (!user.includes(":") && !url.password) {
      try {
        const decoded = decodeBase64(user);
        const at = decoded.lastIndexOf("@");
        if (at >= 0) { user = decoded.slice(0, at); const endpoint = new URL("ss://" + decoded); host = endpoint.hostname; port = Number(endpoint.port); }
        else user = decoded;
      } catch {}
    }
    const separator = user.indexOf(":");
    const node = { id: "share-" + fingerprint(link), name: decodeComponent(url.hash.slice(1)) || "ss", kind: "node", protocol: "shadowsocks", server: host, port, source: "share-link" };
    if (separator >= 0) { node.method = user.slice(0, separator); node.password = user.slice(separator + 1); }
    else if (url.password) { node.method = user; node.password = decodeComponent(url.password); }
    return applyLinkOptions(node, url.searchParams);
  }
  const name = url.hash ? decodeComponent(url.hash.slice(1)) : protocol + "://" + url.hostname + ":" + (url.port || "");
  const node = { id: "share-" + fingerprint(link), name, kind: "node", protocol, server: url.hostname, port: url.port ? Number(url.port) : undefined, source: "share-link" };
  if (url.username) {
    const credential = decodeComponent(url.username);
    if (protocol === "vless" || protocol === "vmess") { node.uuid = credential; node.username = credential; }
    else if (protocol === "trojan") { node.username = credential; node.password = credential; }
    else node.username = credential;
  }
  if (url.password) node.password = decodeComponent(url.password);
  applyLinkOptions(node, url.searchParams);
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "security" && key !== "type" && key !== "encryption") node[key] = value;
  }
  return node;
}

function extractNodes(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.proxies)) return parsed.proxies;
  if (parsed && Array.isArray(parsed.outbounds)) {
    return parsed.outbounds.filter((item) => item && item.type && !["selector", "urltest", "direct", "block", "dns"].includes(item.type));
  }
  if (parsed && Array.isArray(parsed.nodes)) return parsed.nodes;
  return [];
}

function parseStructured(text) {
  let value;
  try { value = JSON.parse(text); } catch {
    try { value = yaml.load(text); } catch { return null; }
  }
  return value && typeof value === "object" ? value : null;
}

function parseShareLinks(text) {
  const normalized = text.replace(/\\n/g, "\n");
  const matches = normalized.match(SHARE_LINK_RE) || [];
  return matches.map((link) => parseShareLink(link));
}

export function classifyImportSource(input) {
  if (typeof input === "string") {
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) return { type: "url", url: text };
    return { type: "text", content: input };
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (input.type === "url" && typeof input.url === "string") return { type: "url", url: input.url.trim() };
    if (input.type === "file" && typeof input.content === "string") return { type: "file", name: input.name || "config", content: input.content };
    if (input.type === "text" && typeof input.content === "string") return { type: "text", content: input.content };
    if (typeof input.content === "string" && typeof input.name === "string") return { type: "file", name: input.name, content: input.content };
  }
  return { type: "structured", value: input };
}

export function parseSubscriptionDocument(input) {
  if (typeof input !== "string" || !input.trim()) throw new TypeError("subscription input must be non-empty text");
  const text = input.trim();
  let parsed = parseStructured(text);
  if (parsed !== null) return { kind: "structured", value: parsed };
  SHARE_LINK_RE.lastIndex = 0;
  if (SHARE_LINK_RE.test(text)) {
    SHARE_LINK_RE.lastIndex = 0;
    return { kind: "share-links", value: parseShareLinks(text) };
  }
  SHARE_LINK_RE.lastIndex = 0;
  let decoded;
  try { decoded = decodeBase64(text).trim(); } catch { decoded = ""; }
  if (decoded && decoded !== text) {
    parsed = parseStructured(decoded);
    if (parsed !== null) return { kind: "base64", value: parsed };
    SHARE_LINK_RE.lastIndex = 0;
    if (SHARE_LINK_RE.test(decoded)) {
      SHARE_LINK_RE.lastIndex = 0;
      return { kind: "share-links", value: parseShareLinks(decoded) };
    }
  }
  throw new Error("unsupported subscription format");
}

export function validateSubscriptionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid subscription URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("subscription URL must use http or https");
  if (url.username || url.password) throw new Error("subscription URL must not contain embedded credentials");
  return url.toString();
}

function responseHeader(response, name) {
  if (!response || !response.headers || typeof response.headers.get !== "function") return null;
  return response.headers.get(name);
}

export async function fetchSubscription(url, { fetcher = globalThis.fetch, maxBytes = 5 * 1024 * 1024 } = {}) {
  let target = validateSubscriptionUrl(url);
  if (typeof fetcher !== "function") throw new Error("no HTTP fetch implementation available");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer");

  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetcher(target, { redirect: "manual" });
    if (!response) throw new Error("subscription download failed");

    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= MAX_REDIRECTS) throw new Error("subscription redirect limit exceeded");
      const location = responseHeader(response, "location");
      if (!location) throw new Error("subscription redirect missing location");
      target = validateSubscriptionUrl(new URL(location, target).toString());
      continue;
    }

    if (!response.ok) throw new Error("subscription download failed");
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader(); const chunks = []; let total = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error("subscription exceeds size limit");
        }
        chunks.push(part.value);
      }
      return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("subscription exceeds size limit");
    return text;
  }
}

export function parseSubscription(input, { maxNodes = null } = {}) {
  const document = parseSubscriptionDocument(input);
  const nodes = document.kind === "share-links" ? document.value : extractNodes(document.value);
  return normalizeNodeConfig(nodes, maxNodes);
}
