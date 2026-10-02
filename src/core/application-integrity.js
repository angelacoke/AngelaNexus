import { createHash, verify as verifySignature } from "node:crypto";

export const APPLICATION_INTEGRITY_VERSION = 1;

function hashBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalManifest(manifest) {
  const entries = Array.isArray(manifest?.artifacts) ? manifest.artifacts.map((item) => ({
    path: String(item?.path || ""),
    sha256: String(item?.sha256 || "").toLowerCase()
  })).sort((a, b) => a.path.localeCompare(b.path)) : [];
  return JSON.stringify({ version: manifest?.version ?? null, artifacts: entries });
}

export function applicationArtifactDigest(value) {
  return hashBytes(value);
}

export function verifyApplicationManifest(manifest, {
  signature = null,
  publicKey = null,
  currentVersion = null,
  now = Date.now()
} = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return Object.freeze({ ok: false, code: "APP_INTEGRITY_MANIFEST_INVALID", errors: Object.freeze([{ code: "APP_INTEGRITY_MANIFEST_INVALID" }]) });
  }

  const version = Number(manifest.version);
  if (!Number.isInteger(version) || version < 1) errors.push({ code: "APP_INTEGRITY_VERSION_INVALID" });
  if (Number.isInteger(currentVersion) && version <= currentVersion) {
    errors.push({ code: version === currentVersion ? "APP_INTEGRITY_REPLAY" : "APP_INTEGRITY_ROLLBACK_REJECTED" });
  }

  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  if (artifacts.length === 0) errors.push({ code: "APP_INTEGRITY_ARTIFACTS_MISSING" });

  const paths = new Set();
  for (const artifact of artifacts) {
    const path = String(artifact?.path || "");
    const sha256 = String(artifact?.sha256 || "").toLowerCase();
    if (!path || paths.has(path)) errors.push({ code: "APP_INTEGRITY_ARTIFACT_PATH_INVALID" });
    paths.add(path);
    if (!/^[a-f0-9]{64}$/.test(sha256)) errors.push({ code: "APP_INTEGRITY_ARTIFACT_DIGEST_INVALID", path });
  }

  const expiresAt = Date.parse(String(manifest.expiresAt || ""));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) errors.push({ code: "APP_INTEGRITY_MANIFEST_EXPIRED" });

  if (!signature || !publicKey) {
    errors.push({ code: "APP_INTEGRITY_TRUST_ANCHOR_MISSING" });
  } else {
    try {
      const signatureBytes = Buffer.from(signature, "base64");
      const valid = verifySignature(null, Buffer.from(hashBytes(canonicalManifest(manifest)), "hex"), publicKey, signatureBytes);
      if (!valid) errors.push({ code: "APP_INTEGRITY_SIGNATURE_INVALID" });
    } catch {
      errors.push({ code: "APP_INTEGRITY_SIGNATURE_INVALID" });
    }
  }

  return Object.freeze({
    ok: errors.length === 0,
    code: errors.length === 0 ? "APP_INTEGRITY_MANIFEST_VERIFIED" : "APP_INTEGRITY_REJECTED",
    errors: Object.freeze(errors)
  });
}

export function verifyApplicationArtifacts(manifest, artifacts = new Map()) {
  const errors = [];
  for (const expected of Array.isArray(manifest?.artifacts) ? manifest.artifacts : []) {
    const actual = artifacts instanceof Map ? artifacts.get(expected.path) : artifacts?.[expected.path];
    if (actual == null) {
      errors.push({ code: "APP_INTEGRITY_ARTIFACT_MISSING", path: expected.path });
      continue;
    }
    const digest = hashBytes(actual);
    if (digest !== String(expected.sha256).toLowerCase()) {
      errors.push({ code: "APP_INTEGRITY_ARTIFACT_MISMATCH", path: expected.path });
    }
  }
  return Object.freeze({
    ok: errors.length === 0,
    code: errors.length === 0 ? "APP_INTEGRITY_ARTIFACTS_VERIFIED" : "APP_INTEGRITY_ARTIFACTS_REJECTED",
    errors: Object.freeze(errors)
  });
}
