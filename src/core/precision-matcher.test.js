import assert from "node:assert/strict";
import test from "node:test";
import { matchesPrecisionRule, explainPrecisionMatch } from "./precision-matcher.js";

test("matches a concrete application and exact website together", () => {
  const identity = {
    app: { packageId: "com.example.browser" },
    destination: { domain: "api.example.com", port: 443, protocol: "tcp", transport: "tls" },
  };
  assert.equal(matchesPrecisionRule({
    package_id: ["com.example.browser"],
    domain: ["api.example.com"],
    port: [443],
    protocol: ["tcp"],
  }, identity), true);
});

test("uses exact domain semantics without matching a sibling", () => {
  const identity = { destination: { domain: "other.example.com" } };
  assert.equal(matchesPrecisionRule({ domain: ["api.example.com"] }, identity), false);
});

test("supports domain suffix while preserving label boundaries", () => {
  assert.equal(matchesPrecisionRule({ domain_suffix: ["example.com"] }, { destination: { domain: "api.example.com" } }), true);
  assert.equal(matchesPrecisionRule({ domain_suffix: ["example.com"] }, { destination: { domain: "example.com.evil" } }), false);
});

test("supports IPv4 and IPv6 CIDR matching", () => {
  assert.equal(matchesPrecisionRule({ ip: ["192.0.2.0/24"] }, { destination: { ip: "192.0.2.42" } }), true);
  assert.equal(matchesPrecisionRule({ ip: ["2001:db8::/32"] }, { destination: { ip: "2001:db8:1::42" } }), true);
  assert.equal(matchesPrecisionRule({ ip: ["2001:db8::/32"] }, { destination: { ip: "2001:dead::42" } }), false);
});

test("requires every supplied dimension in one rule to match", () => {
  const rule = { package_id: ["com.example.app"], domain: ["api.example.com"], port: [443] };
  assert.equal(matchesPrecisionRule(rule, { app: { packageId: "com.example.app" }, destination: { domain: "api.example.com", port: 80 } }), false);
});

test("multiple values within one dimension are alternatives", () => {
  assert.equal(matchesPrecisionRule({ domain: ["api.example.com", "cdn.example.com"] }, { destination: { domain: "cdn.example.com" } }), true);
});

test("exposes semantics without introducing priority", () => {
  const explanation = explainPrecisionMatch({ package_id: ["com.example.app"] }, { app: { packageId: "com.example.app" } });
  assert.equal(explanation.matched, true);
  assert.deepEqual(explanation.semantics, { dimensions: "AND", valuesWithinDimension: "OR", ruleEvaluation: "parallel" });
});

test("matches platform application and process routing context", () => {
  const identity = {
    platform: "android",
    applicationId: "android:com.example.client",
    package_name: "com.example.client",
    process_name: "com.example.client:proxy",
    process_path: "/data/app/client/base.apk",
    executable: "/data/app/client/lib/client",
  };

  assert.equal(matchesPrecisionRule({
    package_name: ["com.example.client"],
    process_name: ["com.example.client:proxy"],
    process_path: ["/data/app/client/base.apk"],
    executable: ["/data/app/client/lib/client"],
  }, identity), true);

  assert.equal(matchesPrecisionRule({
    package_name: ["com.example.client"],
    process_name: ["com.example.client:other"],
  }, identity), false);
});
