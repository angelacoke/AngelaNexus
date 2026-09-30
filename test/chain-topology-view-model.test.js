import test from "node:test";
import assert from "node:assert/strict";
import { createPipelineSpec } from "../src/platform/pipeline-spec.js";
import { createChainTopology } from "../src/platform/chain-topology.js";
import { HEALTH_STATES } from "../src/platform/chain-health.js";
import { createChainTopologyViewModel, CONNECTION_STATES } from "../src/ui/chain-topology-view-model.js";

const node = (id) => ({
  id,
  protocol: "shadowsocks",
  endpoint: { server: id + ".example", port: 443 }
});

function topology(health) {
  const spec = createPipelineSpec({
    id: "ui-chain",
    hops: [
      { id: "a", kernel: "mihomo", node: node("a"), listen: { host: "127.0.0.1", port: 31001 } },
      { id: "b", kernel: "sing-box", node: node("b"), listen: { host: "127.0.0.1", port: 31002 } },
      { id: "c", kernel: "xray", node: node("c"), listen: { host: "127.0.0.1", port: 31003 } }
    ]
  });
  return createChainTopology(spec, health);
}

test("topology view preserves every hop and kernel without assigning roles", () => {
  const model = createChainTopologyViewModel(topology({
    a: { state: HEALTH_STATES.HEALTHY, latencyMs: 42, success: true },
    b: { state: HEALTH_STATES.DEGRADED, latencyMs: 810, success: true },
    c: { state: HEALTH_STATES.HEALTHY, latencyMs: 71, success: true }
  }));

  assert.deepEqual(model.hops.map((hop) => hop.id), ["a", "b", "c"]);
  assert.deepEqual(model.hops.map((hop) => hop.kernel), ["mihomo", "sing-box", "xray"]);
  assert.equal(model.hops[1].bottleneck, true);
  assert.equal(model.hops[1].connectionState, CONNECTION_STATES.UP);
  assert.equal(model.direction, "left-to-right");
});

test("topology view exposes failed hop and failed connection state", () => {
  const model = createChainTopologyViewModel(topology({
    a: { state: HEALTH_STATES.HEALTHY, latencyMs: 30, success: true },
    b: { state: HEALTH_STATES.DOWN, latencyMs: null, success: false },
    c: { state: HEALTH_STATES.HEALTHY, latencyMs: 60, success: true }
  }));

  assert.equal(model.hops[1].connectionState, CONNECTION_STATES.DOWN);
  assert.equal(model.edges[0].state, CONNECTION_STATES.DOWN);
  assert.equal(model.edges[1].state, CONNECTION_STATES.DOWN);
  assert.equal(model.hasFailure, true);
});

test("topology view rejects incomplete platform topology", () => {
  assert.throws(
    () => createChainTopologyViewModel({ hops: [] }),
    /topology model/
  );
});
