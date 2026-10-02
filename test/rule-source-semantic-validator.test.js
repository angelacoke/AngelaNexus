import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { validateRuleSourceSemantics } from "../src/core/rule-source-semantic-validator.js";
import { createRuleSourceUpdateManager } from "../src/core/rule-source-update-manager.js";

function validSource(action = { type: "route", target: "secure" }) {
  return JSON.stringify({
    version: 1,
    rules: [{
      id: "rule-1",
      name: "example",
      enabled: true,
      match: { domain: "example.com" },
      action
    }]
  });
}

test("semantic validator accepts a structurally valid rule source", () => {
  const result = validateRuleSourceSemantics(Buffer.from(validSource(), "utf8"));
  assert.equal(result.ok, true);
  assert.equal(result.ruleCount, 1);
});

test("semantic validator rejects unknown match types", () => {
  const result = validateRuleSourceSemantics(Buffer.from(JSON.stringify({
    rules: [{ id: "bad", match: { unknown_type: "x" }, action: { type: "reject" } }]
  }), "utf8"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "RULE_SOURCE_UNKNOWN_MATCH_TYPE"));
});

test("semantic validator rejects executable fields", () => {
  const result = validateRuleSourceSemantics(Buffer.from(JSON.stringify({
    rules: [{
      id: "bad",
      match: { domain: "example.com" },
      action: { type: "route", target: "secure" },
      script: "process.exit(1)"
    }]
  }), "utf8"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "RULE_SOURCE_EXECUTABLE_FIELD"));
});

test("semantic validator rejects overlapping rules with conflicting actions", () => {
  const result = validateRuleSourceSemantics(Buffer.from(JSON.stringify({
    rules: [
      { id: "a", match: { domain: "example.com" }, action: { type: "route", target: "secure" } },
      { id: "b", match: { domain: "example.com" }, action: { type: "reject" } }
    ]
  }), "utf8"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "RULE_SOURCE_CONFLICTING_RULES"));
});

test("cryptographically valid but semantically unsafe source cannot activate", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const content = Buffer.from(JSON.stringify({
    rules: [{
      id: "unsafe",
      match: { domain: "example.com" },
      action: { type: "route", target: "secure" },
      command: "iptables -F"
    }]
  }), "utf8");
  const digest = createHash("sha256").update(content).digest("hex");
  const store = createRuleSourceUpdateManager({
    trustPolicy: {
      trustedPublisher: { id: "publisher", algorithm: "ed25519", publicKey },
      requireHttpsForRemote: true,
      requireDigest: true,
      requireSignature: true,
      requireFreshness: true
    },
    now: () => Date.parse("2026-10-01T00:00:00.000Z")
  });

  const result = await store.update(() => ({
    content,
    metadata: {
      url: "https://rules.example.test/rules.dat",
      sha256: digest,
      signature: sign(null, Buffer.from(digest, "hex"), privateKey).toString("base64"),
      version: 1,
      expiresAt: "2099-01-01T00:00:00.000Z"
    }
  }));

  assert.equal(result.ok, false);
  assert.equal(result.stage, "semantic");
  assert.equal(store.getActive(), null);
});

test("semantic validator rejects broad direct security-boundary bypass", () => {
  const result = validateRuleSourceSemantics(Buffer.from(JSON.stringify({
    rules: [{
      id: "broad-bypass",
      match: { ip_cidr: "0.0.0.0/0" },
      action: { type: "bypass", target: "direct" }
    }]
  }), "utf8"));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(item => item.code === "RULE_SOURCE_BROAD_SECURITY_BYPASS"));
});
