import assert from "node:assert/strict";
import test from "node:test";
import {
  RoutingSemantics,
  createRoutingPolicy,
  createRoutingRule,
} from "../src/core/routing-policy.js";
import {
  compileParallelRoutingForKernel,
  createSecureRoutingBaseline,
  evaluateParallelRouting,
} from "../src/platform/routing-strategy.js";

test("parallel routing evaluates all matching rules instead of list order", () => {
  const specific = createRoutingRule({
    id: "ai-openai",
    name: "OpenAI service",
    order: 999,
    match: { domain_suffix: ["openai.com"] },
    action: { type: "route", target: "secure-proxy" },
  });
  const broad = createRoutingRule({
    id: "foreign",
    name: "Foreign traffic",
    order: -999,
    match: { geoip: ["foreign"] },
    action: { type: "route", target: "secure-proxy" },
  });
  const policy = createRoutingPolicy({
    rules: [specific, broad],
    defaultAction: { type: "route", target: "secure-proxy" },
  });

  const result = evaluateParallelRouting(policy, {
    domain: "api.openai.com",
    geoip: "foreign",
  });

  assert.equal(result.semantics, RoutingSemantics.PARALLEL);
  assert.deepEqual(result.matchedRuleIds, ["ai-openai", "foreign"]);
  assert.equal(result.selected.id, "ai-openai");
});

test("secure baseline never defaults public unknown traffic to direct", () => {
  const baseline = createSecureRoutingBaseline();
  assert.equal(baseline.security.foreignFailClosed, true);
  assert.equal(baseline.defaultAction.target, "secure-proxy");

  const domestic = evaluateParallelRouting({
    rules: baseline.rules,
    defaultAction: baseline.defaultAction,
  }, { geosite: ["cn"], domain: "example.cn" });
  assert.equal(domestic.action.target, "domestic-direct");

  const unknown = evaluateParallelRouting({
    rules: baseline.rules,
    defaultAction: baseline.defaultAction,
  }, { domain: "unknown-public.example" });
  assert.equal(unknown.action.target, "secure-proxy");
});

test("the same semantic policy compiles for all three kernels", () => {
  const policy = createSecureRoutingBaseline();
  for (const kernel of ["mihomo", "sing-box", "xray"]) {
    const compiled = compileParallelRoutingForKernel(policy, kernel);
    assert.equal(compiled.kernel, kernel);
    assert.equal(compiled.evaluation, "parallel-candidates-then-specificity");
  }
});
