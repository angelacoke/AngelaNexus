import yaml from "js-yaml";
import { normalizeNodeConfig } from "./config.js";

const SHARE_PROTOCOLS = "(?:vmess|vless|trojan|ss|hysteria2|hy2|tuic|anytls)";
const SHARE_LINK_RE = new RegExp(SHARE_PROTOCOLS + "://[^\\s\\\\]+", "gi");

function decodeBase64(value) {
  const normalized = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
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
  const name = url.hash ? decodeURIComponent(url.hash.slice(1)) : protocol + "://" + url.hostname + ":" + (url.port || "");
  const node = {
    id: "share-" + fingerprint(link),
    name,
    kind: "node",
    protocol,
    server: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    source: "share-link"
  };

  if (url.username) node.username = decodeURIComponent(url.username);
  if (url.password) node.password = decodeURIComponent(url.password);

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
  try { return JSON.parse(text); } catch {
    try { return yaml.load(text); } catch { return null; }
  }
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
  if (SHARE_LINK_RE.test(text)) {
    SHARE_LINK_RE.lastIndex = 0;
    return { kind: "share-links", value: parseShareLinks(text) };
  }
  let parsed = parseStructured(text);
  if (parsed !== null) return { kind: "structured", value: parsed };
  parsed = parseStructured(decodeBase64(text));
  if (parsed !== null) return { kind: "base64", value: parsed };
  throw new Error("unsupported subscription format");
}

export function validateSubscriptionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid subscription URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("subscription URL must use http or https");
  if (url.username || url.password) throw new Error("subscription URL must not contain embedded credentials");
  return url.toString();
}

export async function fetchSubscription(url, { fetcher = globalThis.fetch, maxBytes = 5 * 1024 * 1024 } = {}) {
  const target = validateSubscriptionUrl(url);
  if (typeof fetcher !== "function") throw new Error("no HTTP fetch implementation available");
  const response = await fetcher(target, { redirect: "follow" });
  if (!response || !response.ok) throw new Error("subscription download failed");
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > maxBytes) { try { await reader.cancel(); } catch {} throw new Error("subscription exceeds size limit"); } chunks.push(part.value); }
    return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("subscription exceeds size limit");
  return text;
}

export function parseSubscription(input, { maxNodes = null } = {}) {
  const document = parseSubscriptionDocument(input);
  const nodes = document.kind === "share-links" ? document.value : extractNodes(document.value);
  return normalizeNodeConfig(nodes, maxNodes);
}
