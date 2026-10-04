import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../core/model.js";
import { createKernelAwarePipelineRuntime } from "./kernel-aware-pipeline-runtime.js";

const VLESS = {
  id: "node-1",
  name: "Node 1",
  protocol: "vless",
  server: "example.com",
  port: 443,
  uuid: "00000000-0000-4000-8000-000000000001",
  tls: true,
  network: "ws",
  path: "/",
};

const drivers = {
  mihomo: {
    compileNode: (node) => ({ kernel: "mihomo", proxies: [{ name: node.name }] }),
  },
  "sing-box": {
    compileNode: (node) => ({ kernel: "sing-box", outbounds: [{ tag: node.name }] }),
  },
  xray: {
    compileNode: (node) => ({ kernel: "xray", outbounds: [{ tag: node.name }] }),
  },
};

test("materializes deterministic proxy kernel selection into platform runtime", () => {
  const runtime = createKernelAwarePipelineRuntime({
    pipeline: { id: "proxy-1", mode: "proxy", target: "node-1" },
    nodes: { "node-1": VLESS },
    listens: { "node-1": { host: "127.0.0.1", port: 18080 } },
    inbound: { host: "127.0.0.1", port: 18000 },
    drivers,
  });

  assert.equal(runtime.kernelPlan.ok, true);
  assert.equal(runtime.kernelPlan.hops[0].kernel, Kernels.MIHOMO);
  assert.equal(runtime.spec.hops[0].kernel, Kernels.MIHOMO);
  assert.equal(runtime.spec.hops[0].listen.port, 18080);
  assert.equal(typeof runtime.prepare, "function");
});

test("fails closed before creating a runtime when a pipeline node is unavailable", () => {
  assert.throws(
    () => createKernelAwarePipelineRuntime({
      pipeline: { id: "chain-1", mode: "chain", hops: [{ id: "missing-a" }, { id: "missing-b" }] },
      nodes: {},
      listens: {},
      drivers,
    }),
    /cannot be assigned an executable kernel|cannot be resolved/i,
  );
});

test("does not silently create a kernel runtime for direct or reject modes", () => {
  const direct = createKernelAwarePipelineRuntime({
    pipeline: { id: "direct-1", mode: "direct" },
    nodes: {},
    listens: {},
  });
  assert.equal(direct.runtime, null);
  assert.equal(direct.kernelPlan.ok, true);
  assert.rejects(direct.start(), /do not create a kernel runtime/);
});
