import { verifySubscriptionUpdate } from "./config-integrity.js";

export const UPDATE_TRUST_POLICY_VERSION = 1;

export const UpdateTrustDefaults = Object.freeze({
  requireAuthenticity: false,
  requireIntegrity: true,
  requireFreshness: false,
  rejectSecrets: true
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizePublisher(publisher) {
  if (!publisher || typeof publisher !== "object") return null;
  const id = typeof publisher.id === "string" ? publisher.id.trim() : "";
  const algorithm = typeof publisher.algorithm === "string" ? publisher.algorithm.toLowerCase() : "ed25519";
  const publicKey = typeof publisher.publicKey === "string" ||
    Buffer.isBuffer(publisher.publicKey) ||
    (publisher.publicKey && typeof publisher.publicKey === "object")
    ? publisher.publicKey
    : null;
  if (!id || !publicKey || algorithm !== "ed25519") return null;
  return Object.freeze({ id, algorithm, publicKey });
}

export function createUpdateTrustPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const publisher = normalizePublisher(source.trustedPublisher);
  const policy = {
    ...clone(UpdateTrustDefaults),
    ...clone(source),
    trustedPublisher: publisher
  };
  const errors = [];

  if (policy.requireAuthenticity && !publisher) {
    errors.push(Object.freeze({
      code: "UPDATE_TRUST_ANCHOR_REQUIRED",
      severity: "error",
      key: "trustedPublisher",
      message: "publisher authenticity requires an independently provisioned Ed25519 trust anchor"
    }));
  }

  return Object.freeze({
    version: UPDATE_TRUST_POLICY_VERSION,
    ok: errors.length === 0,
    policy: Object.freeze(policy),
    errors: Object.freeze(errors)
  });
}

export function evaluateUpdateTrust(incoming, {
  policy = {},
  signature = null,
  expectedDigest = null,
  incomingVersion = null,
  currentVersion = null
} = {}) {
  const normalized = createUpdateTrustPolicy(policy);
  if (!normalized.ok) {
    return Object.freeze({
      ok: false,
      action: "reject",
      code: "UPDATE_TRUST_POLICY_INVALID",
      errors: normalized.errors,
      verification: null
    });
  }

  const effective = normalized.policy;
  const verification = verifySubscriptionUpdate(incoming, {
    expectedDigest,
    signature,
    publicKey: effective.trustedPublisher ? effective.trustedPublisher.publicKey : null,
    requireIntegrity: effective.requireIntegrity,
    requireAuthenticity: effective.requireAuthenticity,
    rejectSecrets: effective.rejectSecrets,
    incomingVersion,
    currentVersion,
    requireFreshness: effective.requireFreshness
  });

  return Object.freeze({
    ok: verification.ok,
    action: verification.action,
    code: verification.ok ? "UPDATE_TRUST_VERIFIED" : "UPDATE_TRUST_REJECTED",
    errors: verification.errors,
    verification
  });
}
