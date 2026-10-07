import test from "node:test";
import { generateKeyPairSync, sign as signData } from "node:crypto";
import assert from "node:assert/strict";
import {
  configIntegrityDigest,
  verifyConfigIntegrity,
  scanSecrets,
  validateSecretHandling,
  verifySubscriptionUpdate,
  verifyPublisherSignature,
  verifyUpdateFreshness
} from "../src/core/config-integrity.js";
import { sha256Utf8 } from "../src/core/config-integrity-portable.js";

test("portable SHA-256 matches the standard vector", () => {
  assert.equal(sha256Utf8("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

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

test("credential URI is detected without being classified as accidental secret leakage", () => {
  const result = scanSecrets("vless://uuid@example.com:443");
  assert.equal(result.safe, true);
  assert.equal(result.findings[0].type, "credential-uri");
  assert.equal(validateSecretHandling("vless://uuid@example.com:443").credentialBearing, true);
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

test("publisher signature verifies independently of the digest reference", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const incoming = "signed-config";
  const digest = Buffer.from(configIntegrityDigest(incoming), "hex");
  const signature = signData(null, digest, privateKey).toString("base64");
  assert.equal(verifyPublisherSignature(incoming, { signature, publicKey }).code, "SIGNATURE_VALID");
  assert.equal(verifyPublisherSignature("tampered", { signature, publicKey }).code, "SIGNATURE_INVALID");
});

test("freshness rejects rollback and accepts newer versions", () => {
  assert.equal(verifyUpdateFreshness(4, 5).code, "UPDATE_ROLLBACK_REJECTED");
  assert.equal(verifyUpdateFreshness(6, 5).ok, true);
});

test("subscription update can require publisher authenticity and freshness", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const incoming = "verified-config";
  const digest = configIntegrityDigest(incoming);
  const signature = signData(null, Buffer.from(digest, "hex"), privateKey).toString("base64");
  const result = verifySubscriptionUpdate(incoming, {
    expectedDigest: digest, signature, publicKey, requireAuthenticity: true,
    requireFreshness: true, incomingVersion: 3, currentVersion: 2
  });
  assert.equal(result.ok, true);
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
