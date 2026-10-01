import test from "node:test";
import assert from "node:assert/strict";
import { resolveRoutingPolicy, resolveRoutingDecision } from "../src/core/policy-engine.js";

test("policy engine resolves the complete Match Set without rule-order priority", () => {
  const result = resolveRoutingPolicy({
    rules: [
      { id: "intl", name: "International", order: 20, match: { geoip: ["!CN"] }, action: { type: "route", target: "Proxy" } },
      { id: "us", name: "US", order: 10, match: { domain_suffix: ["example.com"] }, action: { type: "route", target: "US" } }
    ],
    defaultAction: { type: "reject" }
  }, { domain: "www.example.com", geoip: "US" });

  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.action.type, "reject");
  assert.equal(result.matches.length, 2);
});

test("policy engine supports domain keyword matching", () => {
  const result = resolveRoutingPolicy({
    rules: [{ id: "ai", name: "AI", order: 1, match: { domain_keyword: ["openai"] }, action: { type: "route", target: "AI" } }]
  }, { domain: "api.openai.com" });
  assert.equal(result.action.target, "AI");
});

test("fail-closed rejects when no rule matches", () => {
  const result = resolveRoutingPolicy({
    rules: [{ id: "cn", name: "CN", order: 1, match: { geoip: ["CN"] }, action: { type: "bypass", target: "direct" } }],
    defaultAction: { type: "route", target: "Proxy" }
  }, { geoip: "US" }, { failClosed: true });
  assert.equal(result.action.type, "reject");
});

test("global proxy requires a concrete target", () => {
  const result = resolveRoutingPolicy({ mode: "global_proxy", rules: [], defaultAction: { type: "route", target: "Proxy" } });
  assert.equal(result.action.type, "route");
  assert.equal(result.action.target, "Proxy");
});

test("policy target resolves through the built-in group engine", () => {
  const result = resolveRoutingDecision({
    rules: [{ id: "us", name: "US", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "route", target: "US" } }],
    defaultAction: { type: "reject" }
  }, { domain: "www.example.com" }, {
    groups: { US: { id: "US", name: "US", type: "url_test", members: ["us-1", "us-2"] } },
    nodes: [{ id: "us-1", latencyMs: 80 }, { id: "us-2", latencyMs: 30 }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.action.target, "us-2");
  assert.equal(result.action.group, "US");
});

test("chain policy targets resolve through Chain Resolution when a chain definition is supplied", () => {
  const result = resolveRoutingDecision({
    rules: [{ id: "chain", name: "Chain", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "chain", target: "US-to-JP" } }],
    defaultAction: { type: "reject" }
  }, { domain: "www.example.com" }, {
    chains: {
      "US-to-JP": { id: "US-to-JP", chain: [{ group: "US" }, { id: "jp-1" }] }
    },
    groups: {
      US: { id: "US", name: "US", type: "fallback", members: ["us-1", "us-2"] }
    },
    nodes: [
      { id: "us-1", state: "failed" },
      { id: "us-2", state: "available" },
      { id: "jp-1", state: "available" }
    ]
  });
  assert.equal(result.ok, true);
  assert.equal(result.action.type, "chain");
  assert.equal(result.action.target, "US-to-JP");
  assert.deepEqual(result.hops.map((node) => node.id), ["us-2", "jp-1"]);
});

test("chain policy fails closed when the chain definition is missing", () => {
  const result = resolveRoutingDecision({
    rules: [{ id: "chain", name: "Chain", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "chain", target: "missing" } }],
    defaultAction: { type: "reject" }
  }, { domain: "www.example.com" }, { chains: {} });
  assert.equal(result.ok, false);
  assert.equal(result.action.type, "reject");
  assert.match(result.error, /chain not found/);
});

test("policy rejects when a referenced group has no usable member", () => {
  const result = resolveRoutingDecision({
    rules: [{ id: "us", name: "US", order: 1, match: { domain_suffix: ["example.com"] }, action: { type: "route", target: "US" } }],
    defaultAction: { type: "reject" }
  }, { domain: "www.example.com" }, {
    groups: { US: { id: "US", name: "US", type: "select", members: ["us-1"] } },
    nodes: [{ id: "us-1", state: "failed" }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.action.type, "reject");
});
