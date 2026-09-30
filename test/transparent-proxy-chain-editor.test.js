import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPARENT_PROXY_MODES,
  TRANSPARENT_PROXY_STATES,
  createTransparentProxyConfig,
  evaluateTransparentProxy,
  createTransparentProxyDecision,
} from "../src/platform/transparent-proxy.js";
import {
  CHAIN_SOURCE_TYPES,
  createChainEditorModel,
  validateChainEditorSelection,
} from "../src/platform/chain-editor.js";

test("transparent proxy is TUN-first and fail-closed", () => {
  const config = createTransparentProxyConfig({ enabled: true });
  assert.equal(config.mode, TRANSPARENT_PROXY_MODES.TUN);
  assert.equal(config.security.failClosed, true);
  assert.equal(config.security.allowDirectFallback, false);

  const ready = evaluateTransparentProxy(config, {
    ipv4: true, ipv6: true, udp: true, "dns-capture": true,
    permission: true, ready: true, active: true,
  });
  assert.equal(ready.state, TRANSPARENT_PROXY_STATES.ACTIVE);

  const blocked = createTransparentProxyDecision(config, {
    ipv4: true, ipv6: false, udp: true, "dns-capture": true,
    permission: true, ready: true, active: true,
  });
  assert.equal(blocked.type, "reject");
  assert.equal(blocked.failClosed, true);
});

test("transparent proxy cannot disable fail-closed protection", () => {
  assert.throws(() => createTransparentProxyConfig({ failClosed: false }), /fail-closed/);
});

test("chain editor uses ordered generic hops rather than fixed entry relay exit roles", () => {
  const model = createChainEditorModel({
    nodes: [{ id: "node-a", label: "节点 A" }, { id: "node-b", label: "节点 B" }],
    subscriptions: [{ id: "sub-a", label: "订阅 A" }],
    policyGroups: [{ id: "policy-us", label: "美国策略组" }],
    hops: [
      { id: "hop-a", source: { id: "node-a", type: CHAIN_SOURCE_TYPES.NODE }, kernel: "sing-box" },
      { id: "hop-b", source: { id: "sub-a", type: CHAIN_SOURCE_TYPES.SUBSCRIPTION }, kernel: "xray" },
      { id: "hop-c", source: { id: "policy-us", type: CHAIN_SOURCE_TYPES.POLICY_GROUP }, kernel: "mihomo" },
    ],
  });
  assert.equal(model.hops.length, 3);
  assert.deepEqual(model.visual.edges.map((edge) => [edge.from, edge.to]), [
    ["hop-a", "hop-b"], ["hop-b", "hop-c"],
  ]);
  assert.equal("entry" in model, false);
  assert.equal("relay" in model, false);
  assert.equal("exit" in model, false);
  assert.equal(validateChainEditorSelection(model).valid, true);
});

test("chain editor rejects fewer than two hops", () => {
  assert.throws(() => createChainEditorModel({
    nodes: [{ id: "same", label: "节点" }],
    hops: [{ id: "only", source: { id: "same", type: CHAIN_SOURCE_TYPES.NODE } }],
  }), /at least two ordered hops/);
});

test("chain editor rejects duplicate hop ids", () => {
  const model = {
    hops: [
      { id: "same", source: { id: "a" } },
      { id: "same", source: { id: "b" } },
    ],
  };
  assert.equal(validateChainEditorSelection(model).valid, false);
  assert.equal(validateChainEditorSelection(model).reason, "duplicate-hop-id");
});
