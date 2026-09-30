import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlatformRoutingPlan,
  RoutingSemantics,
  resolvePlatformRoutingDecision,
} from "../src/platform/index.js";

const nodes = [
  { id: "us-1", name: "US West 01" },
  { id: "us-2", name: "US West 02" },
  { id: "jp-1", name: "JP Tokyo 01" },
  { id: "cn-1", name: "CN Shanghai 01" },
];

test("platform routing plan binds concrete services to one region group with auto or explicit node selection", () => {
  const plan = createPlatformRoutingPlan({
    nodes,
    regionOptions: {
      health: {
        "us-1": { available: true, latencyMs: 80 },
        "us-2": { available: true, latencyMs: 40 },
      },
    },
    serviceOverrides: {
      "service:ai:openai": { region: "us", mode: "auto" },
      "service:ai:meta-ai": ["us-1"],
    },
  });

  assert.deepEqual(Object.keys(plan.regionGroups).sort(), ["cn", "jp", "us"]);
  assert.equal(plan.regionGroups.us.nodes.length, 2);
  assert.equal(plan.regionGroups.us.selection.auto.preferredNodeId, "us-2");
  assert.deepEqual(plan.regionGroups.us.selection.manual.selectedNodeIds, []);

  assert.equal(plan.serviceBindings["service:ai:openai"].selection.mode, "auto");
  assert.equal(plan.serviceBindings["service:ai:openai"].selection.region, "us");
  assert.equal(plan.serviceBindings["service:ai:meta-ai"].selection.mode, "manual");

  const openai = plan.policy.rules.find((rule) => rule.policyId === "service:ai:openai");
  const metaAi = plan.policy.rules.find((rule) => rule.policyId === "service:ai:meta-ai");
  assert.ok(openai);
  assert.ok(metaAi);
  assert.equal(openai.routing.serviceKey, "service:ai:openai");
  assert.equal(openai.routing.selection.region, "us");
  assert.equal(openai.routing.selection.mode, "auto");
  assert.equal(metaAi.routing.serviceKey, "service:ai:meta-ai");
  assert.deepEqual(metaAi.routing.selection.nodeIds, ["us-1"]);

  const domesticBank = plan.serviceBindings["service:domestic:banking:abc"];
  assert.ok(domesticBank);
  const abcRule = plan.policy.rules.find((rule) => rule.policyId === "service:domestic:banking:abc");
  assert.ok(abcRule);
  assert.equal(abcRule.routing.serviceKey, "service:domestic:banking:abc");

  assert.equal(plan.policy.semantics, RoutingSemantics.PARALLEL);
  assert.equal(plan.policy.defaultAction.target, "secure-proxy");
});

test("platform routing plan keeps unknown public traffic fail-closed to proxy", () => {
  const plan = createPlatformRoutingPlan({ nodes });
  assert.equal(plan.policy.security.foreignFailClosed, true);
  assert.equal(plan.policy.security.unknownPublicTraffic, "proxy");
  assert.equal(plan.policy.defaultAction.target, "secure-proxy");
});


test("platform routing decision resolves a concrete service to the selected region node", () => {
  const plan = createPlatformRoutingPlan({
    nodes,
    regionOptions: {
      health: {
        "us-1": { available: true, latencyMs: 80 },
        "us-2": { available: true, latencyMs: 40 },
      },
    },
    serviceOverrides: {
      "service:ai:openai": { region: "us", mode: "auto" },
      "service:ai:meta-ai": ["us-1"],
    },
  });

  const openai = resolvePlatformRoutingDecision(plan, { domain: "chat.openai.com" }, {
    health: {
      "us-1": { available: true, latencyMs: 80 },
      "us-2": { available: true, latencyMs: 40 },
    },
  });
  assert.equal(openai.target.type, "node");
  assert.equal(openai.target.serviceKey, "service:ai:openai");
  assert.equal(openai.target.region, "us");
  assert.equal(openai.target.nodeId, "us-2");
  assert.equal(openai.target.selectionMode, "auto");

  const metaAi = resolvePlatformRoutingDecision(plan, { domain: "meta.ai" }, {
    health: {
      "us-1": { available: true, latencyMs: 80 },
      "us-2": { available: true, latencyMs: 40 },
    },
  });
  assert.equal(metaAi.target.nodeId, "us-1");
  assert.equal(metaAi.target.selectionMode, "manual");
});

test("platform routing decision keeps non-service actions kernel-neutral", () => {
  const plan = createPlatformRoutingPlan({ nodes });
  const result = resolvePlatformRoutingDecision(plan, { geoip: ["cn"] });
  assert.equal(result.target.type, "route");
  assert.equal(result.target.target, "domestic-direct");
});


test("platform routing decision does not resolve a node for domestic direct actions", () => {
  const plan = createPlatformRoutingPlan({ nodes });
  const result = resolvePlatformRoutingDecision(plan, { domain: "abchina.com" });
  assert.equal(result.target.type, "route");
  assert.equal(result.target.target, "domestic-direct");
});

test("platform routing decision fails closed when a proxied service has no usable node", () => {
  const plan = createPlatformRoutingPlan({ nodes: [] });
  const result = resolvePlatformRoutingDecision(plan, { domain: "chat.openai.com" });
  assert.equal(result.target.type, "reject");
  assert.equal(result.target.target, "reject");
  assert.equal(result.target.reason, "no-usable-service-node");
});
