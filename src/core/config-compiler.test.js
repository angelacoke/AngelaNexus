import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "./model.js";
import { compileUnifiedConfig } from "./config-compiler.js";

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
