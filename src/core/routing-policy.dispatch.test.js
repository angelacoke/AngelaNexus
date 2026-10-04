import assert from "node:assert/strict";
import test from "node:test";
import { createRoutingPolicy, resolveRoutingPolicyDecision } from "./routing-policy.js";

const policy = createRoutingPolicy({
  rules: [
    {
      id: "android-browser-direct",
      name: "Android browser direct",
      match: { package_name: ["com.example.browser"] },
      action: { type: "bypass", target: "direct" },
    },
    {
      id: "android-browser-proxy-process",
      name: "Browser proxy process",
      match: { process_name: ["com.example.browser:proxy"] },
      action: { type: "route", target: "proxy-us" },
    },
  ],
  defaultAction: { type: "route", target: "default" },
});

test("policy dispatch consumes application and process identity", () => {
  const decision = resolveRoutingPolicyDecision(policy, {
    platform: "android",
    package_name: "com.example.browser",
    process_name: "com.example.browser:proxy",
  });

  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.action, null);
  assert.deepEqual(decision.ruleIds, [
    "android-browser-direct",
    "android-browser-proxy-process",
  ]);
  assert.equal(decision.evidence.matches.length, 2);
});

test("policy dispatch does not use rule order as hidden priority", () => {
  const reversed = createRoutingPolicy({
    rules: [...policy.rules].reverse(),
    defaultAction: policy.defaultAction,
  });
  const decision = resolveRoutingPolicyDecision(reversed, {
    platform: "android",
    package_name: "com.example.browser",
    process_name: "com.example.browser:proxy",
  });

  assert.equal(decision.status, "ambiguous");
  assert.equal(decision.action, null);
});

test("policy dispatch converges identical application/process actions", () => {
  const convergent = createRoutingPolicy({
    rules: [
      {
        id: "app",
        name: "Application",
        match: { package_name: ["com.example.browser"] },
        action: { type: "route", target: "proxy-us" },
      },
      {
        id: "process",
        name: "Process",
        match: { process_name: ["com.example.browser:proxy"] },
        action: { type: "route", target: "proxy-us" },
      },
    ],
  });

  const decision = resolveRoutingPolicyDecision(convergent, {
    package_name: "com.example.browser",
    process_name: "com.example.browser:proxy",
  });

  assert.equal(decision.status, "matched");
  assert.deepEqual(decision.action, { type: "route", target: "proxy-us" });
});

test("policy dispatch uses the explicit default only when nothing matches", () => {
  const decision = resolveRoutingPolicyDecision(policy, {
    platform: "android",
    package_name: "com.example.other",
    process_name: "com.example.other",
  });

  assert.equal(decision.status, "default");
  assert.deepEqual(decision.action, { type: "route", target: "default" });
  assert.deepEqual(decision.ruleIds, []);
});

test("global policies remain explicit and bypass rule evaluation", () => {
  const globalProxy = createRoutingPolicy({ mode: "global_proxy" });
  const globalBypass = createRoutingPolicy({ mode: "global_bypass" });

  assert.deepEqual(
    resolveRoutingPolicyDecision(globalProxy, { package_name: "com.example.app" }).action,
    { type: "route", target: "global_proxy" }
  );
  assert.deepEqual(
    resolveRoutingPolicyDecision(globalBypass, { package_name: "com.example.app" }).action,
    { type: "bypass", target: "direct" }
  );
});
