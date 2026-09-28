import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as signData } from "node:crypto";
import {
  createUpdateTrustPolicy,
  evaluateUpdateTrust
} from "../src/core/update-trust-policy.js";
import { configIntegrityDigest } from "../src/core/config-integrity.js";

test("trust policy can require an independently provisioned publisher anchor", () => {
  const result = createUpdateTrustPolicy({ requireAuthenticity: true });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "UPDATE_TRUST_ANCHOR_REQUIRED");
});

test("configured Ed25519 publisher anchor enables authenticity verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publisher = {
    id: "test-publisher",
    algorithm: "ed25519",
    publicKey
  };
  const policy = createUpdateTrustPolicy({
    requireAuthenticity: true,
    requireIntegrity: true,
    trustedPublisher: publisher
  });
  assert.equal(policy.ok, true);

  const incoming = "trusted-config";
  const digest = configIntegrityDigest(incoming);
  const signature = signData(null, Buffer.from(digest, "hex"), privateKey).toString("base64");
  const result = evaluateUpdateTrust(incoming, {
    policy: policy.policy,
    expectedDigest: digest,
    signature,
    incomingVersion: 3,
    currentVersion: 2
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "UPDATE_TRUST_VERIFIED");
});

test("authenticity cannot be enabled without a trust anchor", () => {
  const result = evaluateUpdateTrust("config", {
    policy: { requireAuthenticity: true },
    expectedDigest: configIntegrityDigest("config")
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UPDATE_TRUST_POLICY_INVALID");
});

test("freshness becomes fail-closed when explicitly required", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const policy = {
    requireAuthenticity: true,
    requireIntegrity: true,
    requireFreshness: true,
    trustedPublisher: { id: "publisher", algorithm: "ed25519", publicKey }
  };
  const incoming = "fresh-config";
  const digest = configIntegrityDigest(incoming);
  const signature = signData(null, Buffer.from(digest, "hex"), privateKey).toString("base64");

  const rejected = evaluateUpdateTrust(incoming, {
    policy,
    expectedDigest: digest,
    signature
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((item) => item.code === "UPDATE_VERSION_INVALID"));

  const accepted = evaluateUpdateTrust(incoming, {
    policy,
    expectedDigest: digest,
    signature,
    incomingVersion: 4,
    currentVersion: 3
  });
  assert.equal(accepted.ok, true);
});

test("default policy preserves existing subscription compatibility while rejecting secrets", () => {
  const incoming = "vless://uuid@example.com:443";
  const policy = createUpdateTrustPolicy();
  const result = evaluateUpdateTrust(incoming, {
    policy: policy.policy,
    expectedDigest: configIntegrityDigest(incoming)
  });
  assert.equal(result.ok, true);
});

test("tampered content is rejected when its original signature is reused", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const policy = {
    requireAuthenticity: true,
    requireIntegrity: true,
    trustedPublisher: { id: "publisher", algorithm: "ed25519", publicKey }
  };
  const original = "original-config";
  const digest = configIntegrityDigest(original);
  const signature = signData(null, Buffer.from(digest, "hex"), privateKey).toString("base64");
  const result = evaluateUpdateTrust("tampered-config", {
    policy,
    expectedDigest: configIntegrityDigest("tampered-config"),
    signature
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "SIGNATURE_INVALID"));
});
