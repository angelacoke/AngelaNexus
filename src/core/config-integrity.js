import { createHash } from "node:crypto";

export const CONFIG_SECURITY_VERSION = 1;

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
  return Object.freeze({ safe: findings.length === 0, findings: Object.freeze(findings) });
}

export function validateSecretHandling(input) {
  const result = scanSecrets(input);
  return Object.freeze({
    ok: result.safe,
    code: result.safe ? "NO_SECRET_DETECTED" : "SECRET_DETECTED",
    findings: result.findings
  });
}

/**
 * Validate a subscription/config update before it replaces a known-good copy.
 * Updates are fail-closed: a digest mismatch, detected secret, or invalid
 * update metadata rejects the replacement. No secret value is returned.
 */
export function verifySubscriptionUpdate(incoming, {
  expectedDigest = null,
  requireIntegrity = true,
  rejectSecrets = true
} = {}) {
  const errors = [];
  if (requireIntegrity) {
    if (!expectedDigest) {
      errors.push(Object.freeze({ code: "UPDATE_INTEGRITY_REFERENCE_MISSING" }));
    } else {
      const integrity = verifyConfigIntegrity(incoming, expectedDigest);
      if (!integrity.ok) errors.push(Object.freeze({
        code: integrity.code,
        expected: integrity.expected,
        actual: integrity.actual
      }));
    }
  }
  if (rejectSecrets) {
    const secrets = scanSecrets(incoming);
    if (!secrets.safe) errors.push(Object.freeze({
      code: "UPDATE_CONTAINS_SECRET",
      findings: secrets.findings
    }));
  }
  return Object.freeze({
    ok: errors.length === 0,
    action: errors.length === 0 ? "accept" : "reject",
    errors: Object.freeze(errors)
  });
}
