import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "./model.js";
import { compileUnifiedConfig } from "./config-compiler.js";
import { analyzeRuleRelationships, evaluateParallelMatchSet } from "./parallel-rule-engine.js";

function baseConfig(profileFeatures) {
  return {
    kernel: Kernels.MIHOMO,
    nodes: [
      { id: "n1", name: "Node 1", protocol: "http", server: "one.example", port: 443 },
      { id: "n2", name: "Node 2", protocol: "http", server: "two.example", port: 443 },
    ],
    chains: [
      { id: "chain-a", mode: "node->node", hops: [{ id: "n1" }, { id: "n2" }] },
    ],
    groups: [
      { id: "auto", name: "Auto", type: "select", members: ["n1", "n2"] },
      { id: "global", name: "Global", type: "select", members: ["n1", "n2"] },
    ],
    routing: {
      rules: [
        { id: "chain-rule", name: "Chain Rule", match: { domain_suffix: ["example.com"] }, action: { type: "chain", target: "chain-a" } },
      ],
    },
    ...(profileFeatures ? { profileFeatures } : {}),
  };
}

test("disabled profile chain removes its routing action and compiles fail-closed", () => {
  const result = compileUnifiedConfig(baseConfig({
    chainEnabled: false,
    chainId: "chain-a",
  }), Kernels.MIHOMO);

  assert.deepEqual(result.chains, []);
  assert.equal(result.config.proxies.find((proxy) => proxy.name === "Node 2")["dialer-proxy"], undefined);
  assert.deepEqual(result.config.rules, ["IP-CIDR6,::/0,REJECT", "DST-PORT,3478,REJECT", "MATCH,REJECT"]);
});

test("enabled profile chain is compiled and its routing action resolves to the final hop", () => {
  const result = compileUnifiedConfig(baseConfig({
    chainEnabled: true,
    chainId: "chain-a",
  }), Kernels.MIHOMO);

  assert.deepEqual(result.chains, [{ id: "chain-a", mode: "node->node", hops: ["n1", "n2"] }]);
  assert.equal(result.config.proxies.find((proxy) => proxy.name === "Node 2")["dialer-proxy"], "Node 1");
  assert.ok(result.config.rules.some((rule) => typeof rule === "string" && rule.endsWith(",Node 2")));
});


test("compiler rejects profile switches that reference unknown groups or chains", () => {
  assert.throws(() => compileUnifiedConfig({
    ...baseConfig(),
    profileFeatures: { disabledGroupIds: ["missing-group"] },
  }, Kernels.MIHOMO), /unknown policy group/);

  assert.throws(() => compileUnifiedConfig({
    ...baseConfig(),
    profileFeatures: { chainEnabled: true, chainId: "missing-chain" },
  }, Kernels.MIHOMO), /unknown chain/);
});

test("compiler exposes the normalized profile feature state for the UI layer", () => {
  const result = compileUnifiedConfig(baseConfig({
    enabledGroupIds: ["auto"],
    disabledGroupIds: ["global"],
    chainEnabled: true,
    chainId: "chain-a",
  }), Kernels.MIHOMO);

  assert.deepEqual(result.profileFeatures.enabledGroupIds, ["auto"]);
  assert.deepEqual(result.profileFeatures.disabledGroupIds, ["global"]);
  assert.equal(result.profileFeatures.chainEnabled, true);
  assert.equal(result.profileFeatures.chainId, "chain-a");
});


test("disabled nested group is removed from effective group output without breaking unrelated groups", () => {
  const config = baseConfig();
  config.groups = [
    { id: "child", name: "Child", type: "select", members: ["n1", "n2"] },
    { id: "parent", name: "Parent", type: "select", members: ["child"] },
    { id: "global", name: "Global", type: "select", members: ["n1", "n2"] },
  ];
  config.routing = {
    rules: [
      { id: "parent-route", name: "Parent Route", match: { domain_suffix: ["parent.example"] }, action: { type: "route", target: "parent" } },
      { id: "global-route", name: "Global Route", match: { domain_suffix: ["global.example"] }, action: { type: "route", target: "global" } },
    ],
  };
  const result = compileUnifiedConfig({
    ...config,
    profileFeatures: { disabledGroupIds: ["child"] },
  }, Kernels.MIHOMO);

  assert.deepEqual(result.inactiveGroups, ["child", "parent"]);
  assert.equal(result.config["proxy-groups"].some((group) => group.name === "Parent"), false);
  assert.equal(result.config.rules.some((rule) => typeof rule === "string" && rule.endsWith(",Parent")), false);
  assert.equal(result.config.rules.some((rule) => typeof rule === "string" && rule.endsWith(",Global")), true);
});

test("chain depending on a disabled nested group is removed fail-closed", () => {
  const config = baseConfig();
  config.groups = [
    { id: "child", name: "Child", type: "select", members: ["n1", "n2"] },
    { id: "parent", name: "Parent", type: "select", members: ["child"] },
    { id: "auto", name: "Auto", type: "select", members: ["n1", "n2"] },
    { id: "global", name: "Global", type: "select", members: ["n1", "n2"] },
  ];
  config.chains = [
    { id: "group-chain", mode: "node->node", hops: [{ group: "parent" }, { id: "n2" }] },
  ];
  config.routing = {
    rules: [
      { id: "chain-route", name: "Chain Route", match: { domain_suffix: ["chain.example"] }, action: { type: "chain", target: "group-chain" } },
    ],
  };

  const result = compileUnifiedConfig({
    ...config,
    profileFeatures: { chainEnabled: true, chainId: "group-chain", disabledGroupIds: ["child"] },
  }, Kernels.MIHOMO);

  assert.deepEqual(result.inactiveGroups, ["child", "parent"]);
  assert.deepEqual(result.inactiveChains, ["group-chain"]);
  assert.deepEqual(result.chains, []);
  assert.equal(result.config.rules.some((rule) => typeof rule === "string" && rule.endsWith(",Node 2")), false);
});


test("platform rule analysis reports overlap without priority semantics", () => {
  const config = baseConfig();
  config.routing.rules = [
    { id: "rule-a", name: "Rule A", match: { domain_suffix: ["same.example"] }, action: { type: "route", target: "auto" } },
    { id: "rule-b", name: "Rule B", match: { domain_suffix: ["same.example"] }, action: { type: "route", target: "global" } },
  ];
  const result = compileUnifiedConfig(config, Kernels.MIHOMO);

  assert.deepEqual(result.routingRelationships, [{
    type: "identical-match",
    leftRuleId: "rule-a",
    leftRuleIndex: 0,
    rightRuleId: "rule-b",
    rightRuleIndex: 1,
    relation: "identical",
  }]);
  assert.equal("routingPriority" in result, false);
});

test("platform rule analysis distinguishes contained domain matches", () => {
  const config = baseConfig();
  config.routing.rules = [
    { id: "broad", name: "Broad", match: { domain_suffix: ["example.com"] }, action: { type: "route", target: "auto" } },
    { id: "exact", name: "Exact", match: { domain: ["api.example.com"] }, action: { type: "route", target: "global" } },
    { id: "sibling", name: "Sibling", match: { domain_suffix: ["other.example.com"] }, action: { type: "route", target: "auto" } },
  ];
  const result = compileUnifiedConfig(config, Kernels.MIHOMO);

  assert.deepEqual(result.routingRelationships, [{
    type: "overlapping-match",
    leftRuleId: "broad",
    leftRuleIndex: 0,
    rightRuleId: "exact",
    rightRuleIndex: 1,
    relation: "contains",
  }]);
});

test("parallel match set evaluates every enabled rule without short-circuiting", () => {
  const rules = [
    { id: "app", match: { app_id: ["com.example.app"] }, action: { type: "route", target: "auto" } },
    { id: "domain", match: { domain: ["api.example.com"] }, action: { type: "route", target: "global" } },
    { id: "disabled", enabled: false, match: { domain: ["api.example.com"] }, action: { type: "route", target: "unused" } },
  ];
  const result = evaluateParallelMatchSet(rules, { app_id: "com.example.app", domain: "api.example.com" },
    (match, flow) => match.app_id?.includes(flow.app_id) || match.domain?.includes(flow.domain));
  assert.deepEqual(result.ruleIds, ["app", "domain"]);
  assert.equal(result.matches.length, 2);
});
