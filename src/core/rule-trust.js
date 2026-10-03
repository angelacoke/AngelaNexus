const KEY_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/;

export const RULE_TRUST_SCHEMA_VERSION = 1;

function assertKeyId(keyId) {
  if (!KEY_ID.test(String(keyId || ""))) {
    throw new Error("rule trust keyId is invalid");
  }
  return String(keyId);
}

function normalizeKeyRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("rule trust key record is invalid");
  }
  const keyId = assertKeyId(record.keyId);
  if (typeof record.publisher !== "string" || !record.publisher.trim()) {
    throw new Error("rule trust key publisher is required");
  }
  if (typeof record.algorithm !== "string" || !record.algorithm.trim()) {
    throw new Error("rule trust key algorithm is required");
  }
  if (record.status !== "active" && record.status !== "revoked") {
    throw new Error("rule trust key status is invalid");
  }
  if (record.status === "revoked" && !record.revokedAt) {
    throw new Error("revoked rule trust key requires revokedAt");
  }
  return Object.freeze({
    keyId,
    publisher: record.publisher.trim(),
    algorithm: record.algorithm.trim(),
    status: record.status,
    createdAt: record.createdAt || null,
    expiresAt: record.expiresAt || null,
    revokedAt: record.revokedAt || null
  });
}

export function createRuleTrustStore(records = []) {
  if (!Array.isArray(records)) throw new Error("rule trust records must be an array");
  const byId = new Map();
  for (const record of records) {
    const normalized = normalizeKeyRecord(record);
    if (byId.has(normalized.keyId)) {
      throw new Error("duplicate rule trust keyId: " + normalized.keyId);
    }
    byId.set(normalized.keyId, normalized);
  }
  return Object.freeze({
    schemaVersion: RULE_TRUST_SCHEMA_VERSION,
    keys: Object.freeze([...byId.values()])
  });
}

export function resolveRuleTrustKey(store, { keyId, publisher, algorithm, at = new Date().toISOString() } = {}) {
  const id = assertKeyId(keyId);
  const key = store?.keys?.find(item => item.keyId === id);
  if (!key) return Object.freeze({ ok: false, reason: "unknown-key" });
  if (key.publisher !== publisher) return Object.freeze({ ok: false, reason: "publisher-mismatch" });
  if (key.algorithm !== algorithm) return Object.freeze({ ok: false, reason: "algorithm-mismatch" });
  if (key.status !== "active") return Object.freeze({ ok: false, reason: "revoked-key" });
  const now = Date.parse(at);
  if (!Number.isFinite(now)) return Object.freeze({ ok: false, reason: "invalid-time" });
  if (key.expiresAt && now >= Date.parse(key.expiresAt)) {
    return Object.freeze({ ok: false, reason: "expired-key" });
  }
  return Object.freeze({ ok: true, key });
}

export async function verifyRuleSignatureAgainstTrustStore(store, {
  publisher,
  algorithm,
  keyId,
  value,
  payload,
  verifySignature,
  at
} = {}) {
  const resolved = resolveRuleTrustKey(store, { keyId, publisher, algorithm, at });
  if (!resolved.ok) return resolved;
  if (typeof verifySignature !== "function") {
    return Object.freeze({ ok: false, reason: "verifier-required" });
  }
  const verified = await verifySignature({
    algorithm,
    keyId,
    value,
    payload,
    key: resolved.key
  });
  return Object.freeze({
    ok: verified === true,
    reason: verified === true ? "verified" : "invalid-signature",
    keyId
  });
}
