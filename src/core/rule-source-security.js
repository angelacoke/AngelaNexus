import { createHash, verify as verifySignature } from "node:crypto";

export const RULE_SOURCE_SECURITY_VERSION = 1;
export const DEFAULT_RULE_SOURCE_MAX_BYTES = 5 * 1024 * 1024;
export const RULE_SOURCE_SCHEMES = Object.freeze(new Set(["https:", "file:", "angelanexus:"]));

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function decodeSignature(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}

function normalizeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function verifyEd25519(content, signature, publicKey) {
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes || !publicKey) return false;
  try {
    const contentDigest = Buffer.from(digest(content), "hex");
    return verifySignature(null, contentDigest, publicKey, signatureBytes);
  } catch {
    return false;
  }
}

export function createRuleSourceTrustPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const allowedHosts = Array.isArray(source.allowedHosts)
    ? [...new Set(source.allowedHosts.map(normalizeHost).filter(Boolean))]
    : [];
  const policy = Object.freeze({
    version: RULE_SOURCE_SECURITY_VERSION,
    requireHttpsForRemote: source.requireHttpsForRemote !== false,
    requireDigest: source.requireDigest !== false,
    requireSignature: source.requireSignature !== false,
    requireFreshness: source.requireFreshness !== false,
    maxBytes: Number.isInteger(source.maxBytes) && source.maxBytes > 0
      ? source.maxBytes : DEFAULT_RULE_SOURCE_MAX_BYTES,
    allowedHosts: Object.freeze(allowedHosts),
    trustedPublisher: source.trustedPublisher || null
  });
  const errors = [];
  if (policy.requireSignature && !policy.trustedPublisher) {
    errors.push({ code: "RULE_SOURCE_TRUST_ANCHOR_REQUIRED" });
  }
  if (policy.requireSignature && policy.trustedPublisher?.algorithm !== "ed25519") {
    errors.push({ code: "RULE_SOURCE_SIGNATURE_ALGORITHM_REQUIRED" });
  }
  return Object.freeze({ ok: errors.length === 0, policy, errors: Object.freeze(errors) });
}

export function evaluateRuleSource(content, metadata = {}, {
  policy = {},
  currentVersion = null,
  now = Date.now()
} = {}) {
  const normalized = createRuleSourceTrustPolicy(policy);
  if (!normalized.ok) {
    return Object.freeze({ ok: false, action: "reject", code: "RULE_SOURCE_POLICY_INVALID", errors: normalized.errors });
  }

  const p = normalized.policy;
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""), "utf8");
  const errors = [];
  const sourceUrl = String(metadata.url || "").trim();
  const remote = /^https?:$/i.test((() => { try { return new URL(sourceUrl).protocol; } catch { return ""; } })());

  if (remote && p.requireHttpsForRemote && !sourceUrl.toLowerCase().startsWith("https://")) {
    errors.push({ code: "RULE_SOURCE_INSECURE_TRANSPORT" });
  }
  if (remote && p.allowedHosts.length > 0 && !p.allowedHosts.includes(normalizeHost(sourceUrl))) {
    errors.push({ code: "RULE_SOURCE_HOST_NOT_ALLOWED" });
  }
  if (bytes.length > p.maxBytes) errors.push({ code: "RULE_SOURCE_TOO_LARGE", maxBytes: p.maxBytes });

  const actualDigest = digest(bytes);
  if (p.requireDigest) {
    const expected = String(metadata.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) errors.push({ code: "RULE_SOURCE_DIGEST_MISSING" });
    else if (expected !== actualDigest) errors.push({ code: "RULE_SOURCE_DIGEST_MISMATCH" });
  }

  if (p.requireSignature && !verifyEd25519(bytes, metadata.signature, p.trustedPublisher?.publicKey)) {
    errors.push({ code: "RULE_SOURCE_SIGNATURE_INVALID" });
  }

  const version = Number(metadata.version);
  if (!Number.isInteger(version) || version < 1) {
    errors.push({ code: "RULE_SOURCE_VERSION_INVALID" });
  } else if (p.requireFreshness && Number.isInteger(currentVersion) && version <= currentVersion) {
    errors.push({ code: version === currentVersion ? "RULE_SOURCE_VERSION_REPLAY" : "RULE_SOURCE_ROLLBACK_REJECTED" });
  }

  const expiresAt = metadata.expiresAt == null ? null : Date.parse(String(metadata.expiresAt));
  if (p.requireFreshness && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    errors.push({ code: "RULE_SOURCE_EXPIRED_OR_EXPIRY_INVALID" });
  }

  return Object.freeze({
    ok: errors.length === 0,
    action: errors.length === 0 ? "accept" : "reject",
    code: errors.length === 0 ? "RULE_SOURCE_TRUST_VERIFIED" : "RULE_SOURCE_TRUST_REJECTED",
    digest: actualDigest,
    errors: Object.freeze(errors)
  });
}
