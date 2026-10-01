import test from "node:test";
import assert from "node:assert/strict";
import { compileLinkedPipeline } from "../src/platform/pipeline-kernel-linker.js";
import { createPipelineSpec } from "../src/platform/pipeline-spec.js";
import { createNodeProfile } from "../src/platform/node-profile.js";

function node(id, protocol = "vmess") {
  return createNodeProfile({
    id,
    name: id,
    protocol,
    server: id + ".example",
    port: 443,
    uuid: "11111111-1111-4111-8111-111111111111",
  });
}

function spec() {
  return createPipelineSpec({
    id: "linked-pipeline",
    inbound: { host: "127.0.0.1", port: 30000 },
    hops: [
      { id: "front", kernel: "mihomo", node: node("front"), listen: { host: "127.0.0.1", port: 31001 } },
      { id: "middle", kernel: "sing-box", node: node("middle"), listen: { host: "127.0.0.1", port: 31002 } },
      { id: "exit", kernel: "xray", node: node("exit"), listen: { host: "127.0.0.1", port: 31003 } },
    ],
  });
}

test("linked pipeline compiles explicit kernel-to-kernel TCP links", () => {
  const result = compileLinkedPipeline(spec());
  assert.equal(result.transport, "tcp");
  assert.deepEqual(result.hops.map((hop) => hop.inbound.port), [30000, 31002, 31003]);
  assert.deepEqual(result.hops.map((hop) => hop.upstream && hop.upstream.port), [null, 31001, 31002]);

  const mihomo = result.hops[0].config;
  assert.equal(mihomo.listeners[0].port, 30000);
  assert.equal(mihomo.listeners[0].proxy, "front");

  const singBox = result.hops[1].config;
  assert.equal(singBox.inbounds[0].listen_port, 31002);
  assert.equal(singBox.route.rules[0].outbound, "middle");
  const singOutbound = singBox.outbounds.find((item) => item.tag === "middle");
  assert.equal(singOutbound.detour, "Nexus-PipelineLink-middle");

  const xray = result.hops[2].config;
  assert.equal(xray.inbounds[0].port, 31003);
  assert.equal(xray.routing.rules[0].outboundTag, "exit");
  const xrayOutbound = xray.outbounds.find((item) => item.tag === "exit");
  assert.equal(xrayOutbound.streamSettings.sockopt.dialerProxy, "Nexus-PipelineLink-exit");
});

test("linked pipeline rejects missing application ingress", () => {
  const value = spec();
  assert.throws(() => compileLinkedPipeline({ ...value, inbound: null }), /pipeline inbound is required/);
});

test("linked pipeline keeps internal links loopback-only", () => {
  const value = spec();
  const broken = createPipelineSpec({
    id: value.id,
    inbound: value.inbound,
    hops: [
      value.hops[0],
      { ...value.hops[1], listen: { host: "0.0.0.0", port: 31002 } },
      value.hops[2],
    ],
  });
  assert.throws(() => compileLinkedPipeline(broken), /loopback/);
});
