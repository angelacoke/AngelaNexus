import test from "node:test";
import assert from "node:assert/strict";
import {
  configIntegrityDigest,
  verifyConfigIntegrity,
  scanSecrets,
  validateSecretHandling,
  verifySubscriptionUpdate
} from "../src/core/config-integrity.js";

test("object integrity digest is deterministic across key order", () => {
  assert.equal(
    configIntegrityDigest({ b: 2, a: 1 }),
    configIntegrityDigest({ a: 1, b: 2 })
  );
});

test("integrity verification distinguishes match from tampering", () => {
  const config = { server: "example.com", port: 443 };
  const digest = configIntegrityDigest(config);
  assert.equal(verifyConfigIntegrity(config, digest).code, "INTEGRITY_MATCH");
  assert.equal(verifyConfigIntegrity({ ...config, port: 8443 }, digest).code, "INTEGRITY_MISMATCH");
});

test("invalid integrity reference fails closed", () => {
  assert.equal(verifyConfigIntegrity("config", "bad").ok, false);
});

test("secret scan reports categories without exposing secret values", () => {
  const result = scanSecrets("token: ghp_abcdefghijklmnopqrstuvwxyz123456");
  assert.equal(result.safe, false);
  assert.equal(result.findings[0].type, "github-token");
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrstuvwxyz123456/);
});

test("private keys are rejected from security-sensitive input", () => {
  assert.equal(validateSecretHandling("-----BEGIN PRIVATE KEY-----").ok, false);
});

test("credential URI is treated as sensitive material", () => {
  assert.equal(scanSecrets("vless://uuid@example.com:443").safe, false);
});

test("subscription update requires integrity reference by default", () => {
  const result = verifySubscriptionUpdate("new-config");
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "UPDATE_INTEGRITY_REFERENCE_MISSING");
});

test("subscription update rejects digest mismatch", () => {
  const result = verifySubscriptionUpdate("new-config", {
    expectedDigest: configIntegrityDigest("old-config")
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "INTEGRITY_MISMATCH");
});

test("subscription update accepts verified content", () => {
  const incoming = "verified-config";
  const result = verifySubscriptionUpdate(incoming, {
    expectedDigest: configIntegrityDigest(incoming)
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, "accept");
});

test("subscription update rejects detected secrets without exposing them", () => {
  const incoming = "token: ghp_abcdefghijklmnopqrstuvwxyz123456";
  const result = verifySubscriptionUpdate(incoming, {
    expectedDigest: configIntegrityDigest(incoming)
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "UPDATE_CONTAINS_SECRET"));
  assert.doesNotMatch(JSON.stringify(result), /abcdefghijklmnopqrstuvwxyz123456/);
});
