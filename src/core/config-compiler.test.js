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
    routing: {
      rules: [
        { id: "chain-rule", action: { type: "chain", target: "chain-a" } },
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
  assert.deepEqual(result.config.rules, ["MATCH,REJECT"]);
});

test("enabled profile chain is compiled and its routing action resolves to the final hop", () => {
  const result = compileUnifiedConfig(baseConfig({
    chainEnabled: true,
    chainId: "chain-a",
  }), Kernels.MIHOMO);

  assert.deepEqual(result.chains, [{ id: "chain-a", mode: "node->node", hops: ["n1", "n2"] }]);
  assert.equal(result.config.proxies.find((proxy) => proxy.name === "Node 2")["dialer-proxy"], "Node 1");
  assert.ok(result.config.rules.includes("MATCH,Node 2"));
});
