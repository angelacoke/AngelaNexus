import test from "node:test";
import assert from "node:assert/strict";
import { createPipelineLinkPlan } from "../src/platform/pipeline-linker.js";
import { createPipelineSpec } from "../src/platform/pipeline-spec.js";
import { createNodeProfile } from "../src/platform/node-profile.js";

function node(id) {
  return createNodeProfile({
    id,
    name: id,
    protocol: "vmess",
    server: id + ".example",
    port: 443,
  });
}

function spec() {
  return createPipelineSpec({
    id: "link-plan",
    hops: [
      { id: "a", kernel: "sing-box", node: node("a"), listen: { host: "127.0.0.1", port: 31001 } },
      { id: "b", kernel: "xray", node: node("b"), listen: { host: "127.0.0.1", port: 31002 } },
      { id: "c", kernel: "mihomo", node: node("c"), listen: { host: "127.0.0.1", port: 31003 } },
    ],
  });
}

test("pipeline link plan connects adjacent hops without kernel roles", () => {
  const plan = createPipelineLinkPlan(spec());
  assert.equal(plan.pipelineId, "link-plan");
  assert.equal(plan.firstHopId, "a");
  assert.equal(plan.lastHopId, "c");
  assert.deepEqual(plan.links.map(x => [x.fromHopId, x.toHopId]), [["a", "b"], ["b", "c"]]);
  assert.deepEqual(plan.links.map(x => x.upstream.port), [31001, 31002]);
  assert.ok(plan.links.every(x => !("entry" in x) && !("relay" in x) && !("exit" in x)));
});

test("pipeline link plan supports explicit TCP-only or UDP-only transport", () => {
  const tcp = createPipelineLinkPlan(spec(), { transports: ["tcp"] });
  const udp = createPipelineLinkPlan(spec(), { transports: ["udp"] });
  assert.deepEqual(tcp.links[0].transports, ["tcp"]);
  assert.deepEqual(udp.links[0].transports, ["udp"]);
});

test("pipeline link plan rejects duplicate listen endpoints", () => {
  const value = spec();
  const broken = createPipelineSpec({
    ...value,
    hops: [
      value.hops[0],
      { ...value.hops[1], listen: { host: "127.0.0.1", port: 31001 } },
      value.hops[2],
    ],
  });
  assert.throws(() => createPipelineLinkPlan(broken), /duplicated/);
});

test("pipeline link plan rejects unsupported transport", () => {
  assert.throws(() => createPipelineLinkPlan(spec(), { transports: ["icmp"] }), /unsupported/);
});
