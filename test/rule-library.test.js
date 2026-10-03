import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRulePackageChecksum,
  canonicalRulePackagePayload,
  compileRulesForKernel,
  mergeRulePackages,
  validateRulePackage,
  verifyAndTrustRulePackage,
  verifyRulePackage,
  isRulePackageTrusted
} from "../src/core/rule-library.js";
import { createRuleTrustStore } from "../src/core/rule-trust.js";

const basePackage = {
  id: "builtin/privacy",
  version: 1,
  schemaVersion: 1,
  source: "builtin",
  publisher: "AngelaNexus",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  rules: [
    {
      id: "privacy.example",
      matchType: "domain-suffix",
      value: "example.com",
      action: "proxy",
      priority: 500
    }
  ]
};

test("validates the platform rule package model", () => {
  assert.equal(validateRulePackage(basePackage), true);
});

test("canonical payload excludes mutable integrity fields", () => {
  const first = canonicalRulePackagePayload(basePackage);
  const second = canonicalRulePackagePayload({
    ...basePackage,
    checksum: "0".repeat(64),
    signature: { algorithm: "test", keyId: "k1", value: "sig" }
  });
  assert.equal(first, second);
});

test("calculates and verifies SHA-256 integrity", async () => {
  const checksum = await calculateRulePackageChecksum(basePackage);
  const verified = await verifyRulePackage({
    ...basePackage,
    checksum
  }, { allowedPublishers: ["AngelaNexus"] });
  assert.equal(verified.ok, true);
  assert.equal(verified.checksumMatches, true);
  assert.equal(verified.publisherAllowed, true);
});

test("rejects publisher, checksum and signature failures", async () => {
  const checksum = await calculateRulePackageChecksum(basePackage);
  const result = await verifyRulePackage({
    ...basePackage,
    source: "external",
    checksum,
    signature: { algorithm: "test", keyId: "trusted", value: "bad" }
  }, {
    allowedPublishers: ["OtherPublisher"],
    verifySignature: async () => false
  });
  assert.equal(result.ok, false);
  assert.equal(result.publisherAllowed, false);
  assert.equal(result.signatureVerified, false);
});

test("higher-trust sources override lower-trust conflicts deterministically", () => {
  const merged = mergeRulePackages([
    {
      ...basePackage,
      source: "external",
      rules: [{ ...basePackage.rules[0], action: "reject" }]
    },
    {
      ...basePackage,
      source: "platform",
      rules: [{ ...basePackage.rules[0], action: "direct" }]
    },
    {
      ...basePackage,
      source: "user",
      rules: [{ ...basePackage.rules[0], action: "proxy" }]
    }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].action, "proxy");
  assert.equal(merged[0].source, "user");
});

test("compiles the unified rule model for every required kernel", () => {
  const rules = mergeRulePackages([basePackage]);
  for (const kernel of ["mihomo", "sing-box", "xray"]) {
    const compiled = compileRulesForKernel(rules, kernel);
    assert.equal(compiled.kernel, kernel);
    assert.equal(compiled.schemaVersion, 1);
    assert.equal(compiled.rules.length, 1);
  }
});

test("external packages require integrity and signature verification", async () => {
  const result = await verifyRulePackage({
    ...basePackage,
    source: "external"
  }, {
    allowedPublishers: ["AngelaNexus"]
  });
  assert.equal(result.integrityRequired, true);
  assert.equal(result.signatureRequired, true);
  assert.equal(result.ok, false);
});

test("verified external packages pass the trust gate", async () => {
  const checksum = await calculateRulePackageChecksum({
    ...basePackage,
    source: "external"
  });
  const result = await verifyRulePackage({
    ...basePackage,
    source: "external",
    checksum,
    signature: { algorithm: "test", keyId: "trusted", value: "valid" }
  }, {
    allowedPublishers: ["AngelaNexus"],
    verifySignature: async () => true
  });
  assert.equal(result.ok, true);
});


test("external packages are denied when the publisher allowlist is empty", async () => {
  const checksum = await calculateRulePackageChecksum({
    ...basePackage,
    source: "external"
  });
  const result = await verifyRulePackage({
    ...basePackage,
    source: "external",
    checksum,
    signature: { algorithm: "test", keyId: "trusted", value: "valid" }
  }, {
    verifySignature: async () => true
  });
  assert.equal(result.publisherAllowed, false);
  assert.equal(result.ok, false);
});

test("external packages become trusted only after successful verification", async () => {
  const external = {
    ...basePackage,
    source: "external",
    checksum: await calculateRulePackageChecksum({ ...basePackage, source: "external" }),
    signature: { algorithm: "test", keyId: "trusted", value: "valid" }
  };

  assert.equal(isRulePackageTrusted(external), false);
  await verifyAndTrustRulePackage(external, {
    allowedPublishers: ["AngelaNexus"],
    verifySignature: async () => true
  });
  assert.equal(isRulePackageTrusted(external), true);
});

test("failed external verification never grants trust", async () => {
  const external = {
    ...basePackage,
    source: "external",
    checksum: await calculateRulePackageChecksum({ ...basePackage, source: "external" }),
    signature: { algorithm: "test", keyId: "trusted", value: "invalid" }
  };
  await assert.rejects(
    () => verifyAndTrustRulePackage(external, {
      allowedPublishers: ["AngelaNexus"],
      verifySignature: async () => false
    }),
    /trust verification failed/
  );
  assert.equal(isRulePackageTrusted(external), false);
});


test("external verification can require a trusted key lifecycle", async () => {
  const external = {
    ...basePackage,
    source: "external",
    checksum: await calculateRulePackageChecksum({ ...basePackage, source: "external" }),
    signature: {
      algorithm: "test",
      keyId: "angelanexus/rules-2026",
      value: "valid"
    }
  };
  const trustStore = createRuleTrustStore([{
    keyId: "angelanexus/rules-2026",
    publisher: "AngelaNexus",
    algorithm: "test",
    status: "active",
    createdAt: "2026-10-03T00:00:00Z",
    expiresAt: "2027-10-03T00:00:00Z"
  }]);
  const verified = await verifyRulePackage(external, {
    allowedPublishers: ["AngelaNexus"],
    trustStore,
    at: "2026-10-03T01:00:00Z",
    verifySignature: async ({ key }) => key.keyId === "angelanexus/rules-2026"
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.trustResult.ok, true);
});
