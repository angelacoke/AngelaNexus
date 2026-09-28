import test from "node:test";
import assert from "node:assert/strict";
import {
  createSystemSecurityPolicy,
  validateSystemSecurityPolicy,
  securityEvidence,
  composeSecurityPolicy
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

test("user security preferences are preserved when compatible", () => {
  const result = composeSecurityPolicy({}, {
    security: {
      blockWebRTC3478: true,
      chinaNetworkOptimization: {
        foreignAction: "chain",
        dnsMode: "native"
      }
    }
  });
  assert.equal(result.policy.blockWebRTC3478, true);
  assert.equal(result.policy.chinaNetworkOptimization.foreignAction, "chain");
  assert.equal(result.policy.chinaNetworkOptimization.dnsMode, "native");
  assert.deepEqual(result.conflicts, []);
  assert.ok(result.preserved.includes("chinaNetworkOptimization.foreignAction"));
});

test("weaker user security settings do not silently disable the system floor", () => {
  const result = composeSecurityPolicy({}, {
    security: {
      failClosed: false,
      killSwitch: false,
      encryptedDns: false
    }
  });
  assert.equal(result.policy.failClosed, true);
  assert.equal(result.policy.killSwitch, true);
  assert.equal(result.conflicts.length, 2);
  assert.equal(result.conflicts[0].resolution, "system-floor");
  assert.equal(result.conflicts[1].resolution, "system-floor");
  assert.equal(result.policy.encryptedDns, true);
});

test("user routing policy is not overwritten by the system optimization default", () => {
  const result = composeSecurityPolicy({}, {
    security: {
      chinaNetworkOptimization: {
        domesticAction: "proxy",
        foreignAction: "reject"
      }
    }
  });
  assert.equal(result.policy.chinaNetworkOptimization.domesticAction, "proxy");
  assert.equal(result.policy.chinaNetworkOptimization.foreignAction, "reject");
});

test("user policy remains separate from the original native configuration", () => {
  const nativeConfig = {
    security: { failClosed: true, encryptedDns: true },
    routing: { defaultAction: { type: "route", target: "secure" } }
  };
  const result = composeSecurityPolicy({}, nativeConfig);
  assert.equal(nativeConfig.routing.defaultAction.type, "route");
  assert.equal(result.policy.failClosed, true);
});

test("security evidence remains machine-readable after composition", () => {
  const result = composeSecurityPolicy({}, { security: { failClosed: false } });
  assert.equal(result.policy.failClosed, true);
  assert.equal(result.conflicts[0].code, "USER_SECURITY_WEAKER_THAN_SYSTEM_FLOOR");
});

test("security evidence is explicit and verifiable", () => {
  const evidence = securityEvidence();
  assert.equal(evidence.status, "pass");
  assert.equal(evidence.verifiable, true);
  assert.equal(evidence.claim, "engineering-target");
  assert.ok(evidence.checks.every((item) => item.status === "enabled"));
});
