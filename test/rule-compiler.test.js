import test from "node:test";
import assert from "node:assert/strict";
import { compileRulePackagesForKernel } from "../src/core/rule-compiler.js";

const pkg = {
  id: "builtin/pipeline",
  version: 1,
  schemaVersion: 1,
  source: "builtin",
  publisher: "AngelaNexus",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  rules: [
    { id: "privacy.reject", matchType: "domain-suffix", value: "tracker.example", action: "reject", priority: 900 },
    { id: "routing.proxy", matchType: "domain", value: "proxy.example", action: "proxy", priority: 800 }
  ]
};

test("rule packages compile through the unified model for all three kernels", () => {
  for (const kernel of ["mihomo", "sing-box", "xray"]) {
    const result = compileRulePackagesForKernel([pkg], kernel, {
      targets: { proxy: "Nexus-Proxy" }
    });
    assert.equal(result.kernel, kernel);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.rules.length, 2);
    assert.equal(result.routing.length, 2);
  }
});

test("rule compilation rejects proxy rules without an explicit user target", () => {
  assert.throws(
    () => compileRulePackagesForKernel([pkg], "mihomo"),
    /configured target: proxy/
  );
});

test("TUN rules never silently degrade into ordinary routing", () => {
  const tunPackage = {
    ...pkg,
    id: "builtin/tun",
    rules: [
      { id: "tun.example", matchType: "domain", value: "tun.example", action: "tun" }
    ]
  };
  assert.throws(
    () => compileRulePackagesForKernel([tunPackage], "xray"),
    /cannot be silently compiled/
  );
});
