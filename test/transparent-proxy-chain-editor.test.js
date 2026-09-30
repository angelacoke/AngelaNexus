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

test("chain editor exposes node, subscription and policy-group selections", () => {
  const model = createChainEditorModel({
    nodes: [{ id: "entry-node", label: "入口节点" }, { id: "exit-node", label: "出口节点" }],
    subscriptions: [{ id: "sub-a", label: "订阅 A" }],
    policyGroups: [{ id: "policy-us", label: "美国策略组" }],
    entry: { id: "entry-node", type: CHAIN_SOURCE_TYPES.NODE },
    relay: { id: "sub-a", type: CHAIN_SOURCE_TYPES.SUBSCRIPTION },
    exit: { id: "policy-us", type: CHAIN_SOURCE_TYPES.POLICY_GROUP },
  });
  assert.equal(model.visual.roles.length, 3);
  assert.deepEqual(model.visual.edges.map((edge) => [edge.fromRole, edge.toRole]), [
    ["entry", "relay"], ["relay", "exit"],
  ]);
  assert.equal(validateChainEditorSelection(model).valid, true);
});

test("chain editor rejects identical endpoints", () => {
  const model = createChainEditorModel({
    nodes: [{ id: "same", label: "节点" }],
    entry: { id: "same", type: CHAIN_SOURCE_TYPES.NODE },
    exit: { id: "same", type: CHAIN_SOURCE_TYPES.NODE },
  });
  assert.equal(validateChainEditorSelection(model).valid, false);
});
