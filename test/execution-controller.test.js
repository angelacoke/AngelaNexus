import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionController, ExecutionStates } from "../src/core/execution-controller.js";
import { Kernels } from "../src/core/model.js";

function fakeExecutionFactory(config, options) {
  let running = false;
  return {
    kernel: config.kernel,
    configPath: "/tmp/nexus-test/config.json",
    async start() { running = true; return { status: "starting" }; },
    async stop() { running = false; return { status: "stopped" }; },
    async reload() { return { status: "reloading" }; },
    async status() { return { running }; },
    async logs() { return []; }
  };
}

const request = {
  decision: { id: "decision-test-001", version: 1 },
  kernel: Kernels.SING_BOX,
  config: {
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "exit", protocol: "socks", server: "192.0.2.1", port: 1080 }]
  },
  binary: "/usr/bin/sing-box",
  userAuthorized: true,
  security: { preflightPassed: true, failClosed: true },
  path: { validated: true },
};

test("execution controller enforces system execution gates before kernel dispatch", async () => {
  const controller = createExecutionController({ executionFactory: fakeExecutionFactory });
  await controller.prepare(request);
  assert.equal(controller.state, ExecutionStates.READY);
  await controller.start();
  assert.equal(controller.state, ExecutionStates.RUNNING);
  assert.equal((await controller.status()).execution.running, true);
  await controller.stop();
  assert.equal(controller.state, ExecutionStates.IDLE);
});

test("execution controller fails closed when authorization, security, or path validation is missing", async () => {
  const controller = createExecutionController({ executionFactory: fakeExecutionFactory });
  await assert.rejects(
    controller.prepare({ ...request, userAuthorized: false }),
    /explicit user authorization/
  );
  assert.equal(controller.state, ExecutionStates.FAILED);

  const second = createExecutionController({ executionFactory: fakeExecutionFactory });
  await assert.rejects(
    second.prepare({ ...request, security: { preflightPassed: true, failClosed: false } }),
    /fail-closed security mode/
  );

  const third = createExecutionController({ executionFactory: fakeExecutionFactory });
  await assert.rejects(
    third.prepare({ ...request, path: { validated: false } }),
    /validated network path/
  );
});


test("execution controller cleans up a failed start before allowing recovery", async () => {
  let stopped = 0;
  let starts = 0;
  const factory = async () => ({
    configPath: "/tmp/nexus-test/config.json",
    async start() { starts += 1; throw new Error("kernel start failed"); },
    async stop() { stopped += 1; },
    async status() { return { running: false }; },
    async reload() {},
    async logs() { return []; }
  });
  const controller = createExecutionController({ executionFactory: factory });
  await controller.prepare(request);
  await assert.rejects(controller.start(), /kernel start failed/);
  assert.equal(starts, 1);
  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  await controller.prepare(request);
  assert.equal(controller.state, ExecutionStates.READY);
});

test("execution controller can explicitly recover a failed stop state", async () => {
  let stopCalls = 0;
  const factory = async () => ({
    configPath: "/tmp/nexus-test/config.json",
    async start() {},
    async stop() { stopCalls += 1; if (stopCalls === 1) throw new Error("stop failed"); },
    async status() { return { running: true }; },
    async reload() {},
    async logs() { return []; }
  });
  const controller = createExecutionController({ executionFactory: factory });
  await controller.prepare(request);
  await controller.start();
  await assert.rejects(controller.stop(), /stop failed/);
  assert.equal(controller.state, ExecutionStates.FAILED);
  await controller.stop();
  assert.equal(controller.state, ExecutionStates.IDLE);
});
