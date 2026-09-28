import { createHash, verify as verifySignature } from "node:crypto";

export const CONFIG_SECURITY_VERSION = 1;
export const UPDATE_SECURITY_VERSION = 1;

const SECRET_TYPES = new Set(["private-key", "github-token", "generic-api-key", "jwt"]);

const SECRET_PATTERNS = Object.freeze([
  { type: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i },
  { type: "github-token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { type: "generic-api-key", re: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i },
  { type: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { type: "credential-uri", re: /\b(?:vless|vmess|trojan|ss|hysteria2|hy2|tuic|anytls):\/\/[^\s]+/i }
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}

export function configIntegrityDigest(config) {
  const material = typeof config === "string" ? config : canonical(config);
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function verifyConfigIntegrity(config, expectedDigest) {
  if (typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    return Object.freeze({ ok: false, code: "INTEGRITY_REFERENCE_INVALID", reason: "expected SHA-256 digest is invalid" });
  }
  const actual = configIntegrityDigest(config);
  return Object.freeze({
    ok: actual.toLowerCase() === expectedDigest.toLowerCase(),
    code: actual.toLowerCase() === expectedDigest.toLowerCase() ? "INTEGRITY_MATCH" : "INTEGRITY_MISMATCH",
    expected: expectedDigest.toLowerCase(),
    actual
  });
}

export function scanSecrets(input) {
  const text = typeof input === "string" ? input : canonical(input);
  const findings = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) findings.push(Object.freeze({ type: pattern.type }));
  }
  return Object.freeze({ safe: findings.every((item) => !SECRET_TYPES.has(item.type)), findings: Object.freeze(findings) });
}

export function validateSecretHandling(input) {
  const result = scanSecrets(input);
  const secretFindings = result.findings.filter((item) => SECRET_TYPES.has(item.type));
  return Object.freeze({ ok: secretFindings.length === 0, code: secretFindings.length === 0 ? "NO_SECRET_DETECTED" : "SECRET_DETECTED", findings: Object.freeze(secretFindings), credentialBearing: result.findings.some((item) => item.type === "credential-uri") });
}

function decodeSignature(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try { return Buffer.from(value, "base64"); } catch { return null; }
}

export function verifyPublisherSignature(config, { signature = null, publicKey = null, algorithm = "ed25519" } = {}) {
  if (algorithm !== "ed25519") return Object.freeze({ ok: false, code: "SIGNATURE_ALGORITHM_UNSUPPORTED" });
  if (!publicKey || !signature) return Object.freeze({ ok: false, code: "SIGNATURE_REFERENCE_MISSING" });
  const signatureBytes = decodeSignature(signature);
  if (!signatureBytes) return Object.freeze({ ok: false, code: "SIGNATURE_ENCODING_INVALID" });
  try {
    const digestBytes = Buffer.from(configIntegrityDigest(config), "hex");
    const ok = verifySignature(null, digestBytes, publicKey, signatureBytes);
    return Object.freeze({ ok, code: ok ? "SIGNATURE_VALID" : "SIGNATURE_INVALID" });
  } catch {
    return Object.freeze({ ok: false, code: "SIGNATURE_VERIFICATION_ERROR" });
  }
}

export function verifyUpdateFreshness(incomingVersion, currentVersion, { allowEqual = true } = {}) {
  if (!Number.isInteger(incomingVersion) || !Number.isInteger(currentVersion)) return Object.freeze({ ok: false, code: "UPDATE_VERSION_INVALID" });
  if (incomingVersion < currentVersion) return Object.freeze({ ok: false, code: "UPDATE_ROLLBACK_REJECTED", incomingVersion, currentVersion });
  if (!allowEqual && incomingVersion === currentVersion) return Object.freeze({ ok: false, code: "UPDATE_VERSION_NOT_NEWER", incomingVersion, currentVersion });
  return Object.freeze({ ok: true, code: incomingVersion === currentVersion ? "UPDATE_VERSION_EQUAL" : "UPDATE_VERSION_FRESH", incomingVersion, currentVersion });
}

/**
 * Validate a subscription/config update before it replaces a known-good copy.
 * Integrity, authenticity and freshness are separate checks. Trusted references
 * must come from outside the untrusted update payload.
 */
export function verifySubscriptionUpdate(incoming, {
  expectedDigest = null,
  signature = null,
  publicKey = null,
  requireIntegrity = true,
  requireAuthenticity = false,
  rejectSecrets = true,
  incomingVersion = null,
  currentVersion = null,
  requireFreshness = false
} = {}) {
  const errors = [];
  let integrity = null;
  let authenticity = null;
  let freshness = null;
  if (requireIntegrity) {
    if (!expectedDigest) errors.push(Object.freeze({ code: "UPDATE_INTEGRITY_REFERENCE_MISSING" }));
    else {
      integrity = verifyConfigIntegrity(incoming, expectedDigest);
      if (!integrity.ok) errors.push(Object.freeze({ code: integrity.code, expected: integrity.expected, actual: integrity.actual }));
    }
  }
  if (requireAuthenticity) {
    authenticity = verifyPublisherSignature(incoming, { signature, publicKey });
    if (!authenticity.ok) errors.push(Object.freeze({ code: authenticity.code }));
  }
  if (requireFreshness) {
    freshness = verifyUpdateFreshness(incomingVersion, currentVersion);
    if (!freshness.ok) errors.push(Object.freeze({ code: freshness.code, incomingVersion: freshness.incomingVersion, currentVersion: freshness.currentVersion }));
  }
  if (rejectSecrets) {
    const secrets = validateSecretHandling(incoming);
    if (!secrets.ok) errors.push(Object.freeze({ code: "UPDATE_CONTAINS_SECRET", findings: secrets.findings }));
  }
  return Object.freeze({ ok: errors.length === 0, action: errors.length === 0 ? "accept" : "reject", errors: Object.freeze(errors), integrity, authenticity, freshness });
}
