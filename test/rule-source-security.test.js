import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  createRuleSourceTrustPolicy,
  evaluateRuleSource
} from "../src/core/rule-source-security.js";
import { configIntegrityDigest } from "../src/core/config-integrity.js";

function signed(content, privateKey) {
  return sign(null, Buffer.from(configIntegrityDigest(content), "hex"), privateKey).toString("base64");
}

test("rule source trust policy requires an independent signing anchor", () => {
  assert.equal(createRuleSourceTrustPolicy().ok, false);
});

test("rule source accepts verified HTTPS content", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const content = "rules: []";
  const policy = createRuleSourceTrustPolicy({
    allowedHosts: ["rules.example.test"],
    trustedPublisher: { id: "platform-rules", algorithm: "ed25519", publicKey }
  });
  const result = evaluateRuleSource(content, {
    url: "https://rules.example.test/platform.json",
    sha256: configIntegrityDigest(content),
    signature: signed(content, privateKey),
    version: 2,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  }, { policy: policy.policy, currentVersion: 1 });
  assert.equal(result.ok, true);
});

test("tampered rule content is rejected even when digest is changed", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const original = "rules: []";
  const policy = createRuleSourceTrustPolicy({
    trustedPublisher: { id: "platform-rules", algorithm: "ed25519", publicKey }
  });
  const result = evaluateRuleSource("rules: [poisoned]", {
    url: "https://rules.example.test/rules",
    sha256: configIntegrityDigest("rules: [poisoned]"),
    signature: signed(original, privateKey),
    version: 2,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  }, { policy: policy.policy, currentVersion: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "RULE_SOURCE_SIGNATURE_INVALID"));
});

test("rule source rollback and expiry are rejected", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const content = "rules: []";
  const policy = createRuleSourceTrustPolicy({
    trustedPublisher: { id: "platform-rules", algorithm: "ed25519", publicKey }
  });
  const result = evaluateRuleSource(content, {
    url: "https://rules.example.test/rules",
    sha256: configIntegrityDigest(content),
    signature: signed(content, privateKey),
    version: 1,
    expiresAt: new Date(Date.now() - 1000).toISOString()
  }, { policy: policy.policy, currentVersion: 2 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "RULE_SOURCE_ROLLBACK_REJECTED"));
  assert.ok(result.errors.some((item) => item.code === "RULE_SOURCE_EXPIRED_OR_EXPIRY_INVALID"));
});

test("oversized rule source is rejected before admission", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const policy = createRuleSourceTrustPolicy({
    maxBytes: 4,
    trustedPublisher: { id: "platform-rules", algorithm: "ed25519", publicKey }
  });
  const result = evaluateRuleSource("12345", {
    url: "https://rules.example.test/rules",
    sha256: "00".repeat(32),
    signature: "AA==",
    version: 2,
    expiresAt: new Date(Date.now() + 3600000).toISOString()
  }, { policy: policy.policy, currentVersion: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "RULE_SOURCE_TOO_LARGE"));
});
