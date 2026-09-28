import test from "node:test";
import assert from "node:assert/strict";
import {
  createSystemSecurityPolicy,
  validateSystemSecurityPolicy,
  securityEvidence
} from "../src/core/system-security-policy.js";

test("system security policy defaults to fail-closed protection", () => {
  const result = createSystemSecurityPolicy();
  assert.equal(result.ok, true);
  assert.equal(result.policy.failClosed, true);
  assert.equal(result.policy.killSwitch, true);
  assert.equal(result.policy.ipv6LeakPrevention, true);
  assert.equal(result.policy.chinaNetworkOptimization.domesticAction, "direct");
  assert.equal(result.policy.chinaNetworkOptimization.foreignAction, "proxy");
});

test("critical protections cannot be disabled", () => {
  const result = createSystemSecurityPolicy({
    failClosed: false,
    dnsLeakPrevention: false,
    secretProtection: false,
    runtimeVerification: false
  });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((item) => item.key),
    ["failClosed", "dnsLeakPrevention", "secretProtection", "runtimeVerification"]
  );
});

test("China optimization remains a system policy, not a kernel binding", () => {
  const result = createSystemSecurityPolicy({
    chinaNetworkOptimization: {
      domesticAction: "direct",
      foreignAction: "chain"
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.policy.chinaNetworkOptimization.foreignAction, "chain");
});

test("invalid network policy fails closed", () => {
  const result = createSystemSecurityPolicy({
    chinaNetworkOptimization: {
      domesticAction: "maybe",
      foreignAction: "direct",
      dnsMode: "plaintext",
      failClosed: false
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "CHINA_DOMESTIC_ACTION_INVALID"));
  assert.ok(result.errors.some((item) => item.code === "CHINA_FOREIGN_ACTION_INVALID"));
  assert.ok(result.errors.some((item) => item.code === "CHINA_DNS_MODE_INVALID"));
  assert.ok(result.errors.some((item) => item.code === "CHINA_FAIL_CLOSED_REQUIRED"));
});

test("security validation composes with existing kernel-independent security checks", () => {
  const result = validateSystemSecurityPolicy({
    security: {},
    dns: {
      servers: [{ address: "8.8.8.8" }]
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "DNS_PLAINTEXT_SERVER"));
});

test("security evidence is explicit and verifiable", () => {
  const evidence = securityEvidence();
  assert.equal(evidence.status, "pass");
  assert.equal(evidence.verifiable, true);
  assert.equal(evidence.claim, "engineering-target");
  assert.ok(evidence.checks.every((item) => item.status === "enabled"));
});
