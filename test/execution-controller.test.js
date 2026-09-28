import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionController, ExecutionStates } from "../src/core/execution-controller.js";
import { Kernels } from "../src/core/model.js";

function fakeExecutionFactory(config) {
  let running = false;
  return { kernel: config.kernel, configPath: "/tmp/nexus-test/config.json", async start() { running = true; }, async stop() { running = false; }, async reload() {}, async status() { return { running }; }, async logs() { return []; } };
}

const request = {
  decision: { id: "decision-test-001", version: 1, action: "routing", choice: "proxy", requiresUserChoice: true, confirmed: false },
  kernel: Kernels.SING_BOX,
  config: { kernel: Kernels.SING_BOX, nodes: [{ id: "exit", protocol: "socks", server: "192.0.2.1", port: 1080 }] },
  binary: "/usr/bin/sing-box", userAuthorized: true,
  security: { preflightPassed: true, failClosed: true }, path: { validated: true }
};

test("execution controller enforces system execution gates before kernel dispatch", async () => {
  const controller = createExecutionController({ executionFactory: fakeExecutionFactory, pathRevalidator: async path => path });
  await controller.prepare(request); assert.equal(controller.state, ExecutionStates.READY);
  await controller.start(); assert.equal(controller.state, ExecutionStates.RUNNING);
  assert.equal((await controller.status()).execution.running, true);
  await controller.stop(); assert.equal(controller.state, ExecutionStates.IDLE);
});

test("execution controller accepts a planner-produced contract without rebuilding the decision", async () => {
  const controller = createExecutionController({ executionFactory: fakeExecutionFactory, pathRevalidator: async path => path });
  const planned = { id: "planned-001", route: { mode: "proxy", target: "international" }, path: { validated: true }, security: { preflightPassed: true, failClosed: true }, kernel: Kernels.SING_BOX, config: { kernel: Kernels.SING_BOX, nodes: [] }, userAuthorized: true };
  await controller.preparePlanned(planned);
  const snapshot = controller.snapshot();
  assert.equal(snapshot.state, ExecutionStates.READY);
  assert.equal(snapshot.decisionId, "planned-001");
  assert.equal(snapshot.decisionVersion, 1);
  await controller.stop();
});

test("execution controller fails closed when authorization, security, or path validation is missing", async () => {
  const controller = createExecutionController({ executionFactory: fakeExecutionFactory, pathRevalidator: async path => path });
  await assert.rejects(controller.prepare({ ...request, userAuthorized: false }), /explicit user authorization/); assert.equal(controller.state, ExecutionStates.FAILED);
  const second = createExecutionController({ executionFactory: fakeExecutionFactory, pathRevalidator: async path => path });
  await assert.rejects(second.prepare({ ...request, security: { preflightPassed: true, failClosed: false } }), /fail-closed security mode/);
  const third = createExecutionController({ executionFactory: fakeExecutionFactory, pathRevalidator: async path => path });
  await assert.rejects(third.prepare({ ...request, path: { validated: false } }), /validated network path/);
});

test("execution controller cleans up a failed start before allowing recovery", async () => {
  let stopped = 0; let starts = 0;
  const factory = async () => ({ configPath: "/tmp/nexus-test/config.json", async start() { starts += 1; throw new Error("kernel start failed"); }, async stop() { stopped += 1; }, async status() { return { running: false }; }, async reload() {}, async logs() { return []; } });
  const controller = createExecutionController({ executionFactory: factory, pathRevalidator: async path => path });
  await controller.prepare(request); await assert.rejects(controller.start(), /kernel start failed/);
  assert.equal(starts, 1); assert.equal(stopped, 1); assert.equal(controller.state, ExecutionStates.FAILED);
  await controller.prepare(request); assert.equal(controller.state, ExecutionStates.READY);
});

test("execution controller can explicitly recover a failed stop state", async () => {
  let stopCalls = 0;
  const factory = async () => ({ configPath: "/tmp/nexus-test/config.json", async start() {}, async stop() { stopCalls += 1; if (stopCalls === 1) throw new Error("stop failed"); }, async status() { return { running: true }; }, async reload() {}, async logs() { return []; } });
  const controller = createExecutionController({ executionFactory: factory, pathRevalidator: async path => path });
  await controller.prepare(request); await controller.start(); await assert.rejects(controller.stop(), /stop failed/);
  assert.equal(controller.state, ExecutionStates.FAILED); await controller.stop(); assert.equal(controller.state, ExecutionStates.IDLE);
});


test("execution controller rejects a path that changed after decision validation", async () => {
  const controller = createExecutionController({
    executionFactory: fakeExecutionFactory,
    pathRevalidator: async () => ({ validated: true, networkGeneration: 8 })
  });
  await controller.prepare({ ...request, path: { validated: true, networkGeneration: 7 } });
  await assert.rejects(controller.start(), /path changed after decision validation/);
  assert.equal(controller.state, ExecutionStates.FAILED);
});

test("execution controller fails closed when path revalidation fails", async () => {
  const controller = createExecutionController({
    executionFactory: fakeExecutionFactory,
    pathRevalidator: async () => ({ validated: false })
  });
  await controller.prepare(request);
  await assert.rejects(controller.start(), /path revalidation failed/);
  assert.equal(controller.state, ExecutionStates.FAILED);
});
