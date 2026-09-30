import test from "node:test";
import assert from "node:assert/strict";
import { createPipelineRuntime } from "../src/platform/pipeline-runtime.js";
import { createPipelineSpec } from "../src/platform/pipeline-spec.js";
import { createNodeProfile } from "../src/platform/node-profile.js";
import { HEALTH_STATES } from "../src/platform/chain-health.js";

function node(id, server) {
  return createNodeProfile({
    id,
    name: id,
    protocol: "vmess",
    server, port: 443,
  });
}

function spec() {
  return createPipelineSpec({
    id: "live-chain",
    hops: [
      { id: "a", kernel: "sing-box", node: node("a", "a.example"), listen: { host: "127.0.0.1", port: 31001 } },
      { id: "b", kernel: "xray", node: node("b", "b.example"), listen: { host: "127.0.0.1", port: 31002 } },
      { id: "c", kernel: "mihomo", node: node("c", "c.example"), listen: { host: "127.0.0.1", port: 31003 } },
    ],
  });
}

function fakeDriver(kernel, calls) {
  return {
    kernel,
    compileNode(value) {
      calls.push(["compile", kernel, value.id]);
      return { kernel, node: value.id };
    },
    compilePipeline() { throw new Error("not used"); },
    createRuntime(options) {
      calls.push(["create", kernel, options]);
      let running = false;
      return {
        async start() { calls.push(["start", kernel]); running = true; },
        async stop() { calls.push(["stop", kernel]); running = false; },
        async status() { return { kernel, running, pid: running ? 100 : null }; },
      };
    },
  };
}

test("pipeline runtime prepares and starts every parallel kernel hop", async () => {
  const calls = [];
  const drivers = {
    "sing-box": fakeDriver("sing-box", calls),
    xray: fakeDriver("xray", calls),
    mihomo: fakeDriver("mihomo", calls),
  };
  const runtime = createPipelineRuntime({
    spec: spec(),
    drivers,
    runtimeOptions: { a: { binary: "sb" }, xray: { binary: "xr" } },
  });

  const compiled = runtime.prepare();
  assert.deepEqual(compiled.map(x => x.kernel), ["sing-box", "xray", "mihomo"]);
  const status = await runtime.start();
  assert.equal(status.running, true);
  assert.deepEqual(status.hops.map(x => x.kernel), ["sing-box", "xray", "mihomo"]);
  assert.equal(runtime.isRunning(), true);
  await runtime.stop();
  assert.equal(runtime.isRunning(), false);
  assert.deepEqual(calls.filter(x => x[0] === "start").map(x => x[1]), ["sing-box", "xray", "mihomo"]);
  assert.deepEqual(calls.filter(x => x[0] === "stop").map(x => x[1]), ["mihomo", "xray", "sing-box"]);
});

test("pipeline runtime rolls back already started hops on startup failure", async () => {
  const calls = [];
  const drivers = {
    "sing-box": fakeDriver("sing-box", calls),
    xray: {
      kernel: "xray",
      compileNode(value) { return { node: value.id }; },
      compilePipeline() {},
      createRuntime() {
        return {
          async start() { calls.push(["start", "xray"]); throw new Error("xray failed"); },
          async stop() { calls.push(["stop", "xray"]); },
          async status() { return { running: false, pid: null }; },
        };
      },
    },
    mihomo: fakeDriver("mihomo", calls),
  };
  const runtime = createPipelineRuntime({ spec: spec(), drivers });
  await assert.rejects(() => runtime.start(), /xray failed/);
  assert.equal(runtime.isRunning(), false);
  assert.deepEqual(calls.filter(x => x[0] === "stop").map(x => x[1]), ["sing-box"]);
});

test("pipeline runtime publishes live hop health through topology", async () => {
  const drivers = {
    "sing-box": fakeDriver("sing-box", []),
    xray: fakeDriver("xray", []),
    mihomo: fakeDriver("mihomo", []),
  };
  const probe = {
    async probe(value) {
      return value.hopId === "b"
        ? { success: true, latencyMs: 900 }
        : { success: true, latencyMs: 40 };
    },
  };
  const runtime = createPipelineRuntime({
    spec: spec(),
    drivers,
    healthProbe: probe,
    healthMonitorOptions: { thresholds: { degradedMs: 500 } },
  });
  await runtime.start();
  const topology = runtime.topology();
  assert.equal(topology.pipelineId, "live-chain");
  assert.equal(topology.hops.length, 3);
  assert.equal(topology.hops.find(x => x.hopId === "b").state, HEALTH_STATES.DEGRADED);
  assert.equal(topology.health.bottleneckHopId, "b");
  await runtime.stop();
});

test("pipeline runtime keeps kernel roles parallel and does not invent entry relay exit", () => {
  const drivers = {
    "sing-box": fakeDriver("sing-box", []),
    xray: fakeDriver("xray", []),
    mihomo: fakeDriver("mihomo", []),
  };
  const runtime = createPipelineRuntime({ spec: spec(), drivers });
  const prepared = runtime.prepare();
  assert.ok(prepared.every(x => !("role" in x)));
  assert.ok(prepared.every(x => !("entry" in x) && !("relay" in x) && !("exit" in x)));
});
