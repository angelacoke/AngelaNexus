import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "./model.js";
import { createExecutionController } from "./execution-controller.js";

const NODE = {
  id: "node-1", name: "Node 1", protocol: "vless",
  server: "example.com", port: 443,
  uuid: "00000000-0000-4000-8000-000000000001",
  tls: true, network: "ws", path: "/",
};

function input() {
  return {
    id: "decision-1",
    route: { mode: "proxy", target: "node-1" },
    path: { validated: true },
    security: { preflightPassed: true, failClosed: true },
    userAuthorized: true,
    confirmed: true,
    node: NODE,
    configFactory: (kernel) => ({ kernel }),
  };
}

test("execution controller prepares through unified kernel selection", async () => {
  let started = false;
  const controller = createExecutionController({
    pathRevalidator: async (path) => path,
    executionFactory: async () => ({
      configPath: null,
      async start() { started = true; },
      async stop() {},
      async reload() {},
      async status() { return { running: started }; },
      async logs() { return []; },
    }),
  });

  const prepared = await controller.prepareKernelAware(input());
  assert.equal(prepared.state, "ready");
  assert.equal(prepared.kernel, Kernels.MIHOMO);
  assert.equal(prepared.kernelSelection.selected.kernel, Kernels.MIHOMO);

  await controller.start();
  assert.equal(controller.state, "running");
  assert.equal(started, true);
  await controller.stop();
  assert.equal(controller.state, "idle");
});

test("execution controller does not prepare when kernel selection fails", async () => {
  let factoryCalled = false;
  const controller = createExecutionController({
    pathRevalidator: async (path) => path,
    executionFactory: async () => {
      factoryCalled = true;
      return { async start() {}, async stop() {}, async reload() {}, async status() {}, async logs() { return []; } };
    },
  });

  await assert.rejects(
    controller.prepareKernelAware({
      ...input(),
      kernel: "unsupported-kernel",
    }),
    /kernel selection failed|unsupported kernel/
  );
  assert.equal(factoryCalled, false);
  assert.equal(controller.state, "idle");
});
