import assert from "node:assert/strict";
import test from "node:test";
import { evaluateParallelMatchSet, resolveParallelRoutingDecision } from "./parallel-rule-engine.js";

const rules = [
  { id: "browser-direct", enabled: true, match: { package_name: ["com.example.browser"] }, action: { type: "bypass", target: "direct" } },
  { id: "browser-proxy", enabled: true, match: { process_name: ["com.example.browser:proxy"] }, action: { type: "route", target: "proxy-us" } },
];

test("application/process identity participates in the complete parallel match set", () => {
  const result = evaluateParallelMatchSet(rules, {
    package_name: "com.example.browser",
    process_name: "com.example.browser:proxy",
  });
  assert.deepEqual(result.ruleIds, ["browser-direct", "browser-proxy"]);
});

test("conflicting matched application rules fail closed instead of using rule order", () => {
  const result = evaluateParallelMatchSet(rules, {
    package_name: "com.example.browser",
    process_name: "com.example.browser:proxy",
  });
  const decision = resolveParallelRoutingDecision(result);
  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.action, null);
});

test("identical matched actions converge deterministically", () => {
  const result = evaluateParallelMatchSet([
    { id: "a", match: { package_name: ["com.example.browser"] }, action: { type: "bypass", target: "direct" } },
    { id: "b", match: { process_name: ["browser"] }, action: { type: "bypass", target: "direct" } },
  ], { package_name: "com.example.browser", process_name: "browser" });
  const decision = resolveParallelRoutingDecision(result);
  assert.equal(decision.status, "matched");
  assert.deepEqual(decision.action, { type: "bypass", target: "direct" });
});

test("no match uses an explicit default when supplied", () => {
  const decision = resolveParallelRoutingDecision({ matches: [] }, { type: "route", target: "default" });
  assert.equal(decision.status, "default");
  assert.deepEqual(decision.action, { type: "route", target: "default" });
});
