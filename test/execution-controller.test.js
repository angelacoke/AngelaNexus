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

test("execution controller records invalidation evidence in its bounded ledger", async () => {
  let stopCount = 0;
  let notify;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/test-config",
      async start() {},
      async stop() { stopCount += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => path,
    sessionInvalidationSource: async listener => {
      notify = listener;
      return async () => { notify = null; };
    }
  });

  await controller.prepare({
    decision: { id: "decision-1", version: 1, action: "route", choice: "node-a" },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, content: "{}" },
    userAuthorized: true,
    security: { preflightPassed: true, failClosed: true },
    path: { validated: true, networkGeneration: 1 }
  });
  await controller.start();
  await notify({
    reason: "gfw-path-revalidation-required",
    state: "confirmed",
    signals: ["tcp-reset"],
    actions: ["revalidate-path"],
    score: 4,
    confidence: 0.9,
    payload: "must-not-retain"
  });

  assert.equal(stopCount, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.equal(controller.events().length, 1);
  assert.deepEqual(controller.events()[0].context.evidence, {
    state: "confirmed",
    signals: ["tcp-reset"],
    actions: ["revalidate-path"],
    score: 4,
    confidence: 0.9
  });
  assert.equal("payload" in controller.events()[0].context, false);
});

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
  assert.equal(controller.events()[0].type, "execution-failed");
  assert.equal(controller.events()[0].context.reason, "start-failed");
  await controller.prepare(request); assert.equal(controller.state, ExecutionStates.READY);
});

test("execution controller can explicitly recover a failed stop state", async () => {
  let stopCalls = 0;
  const factory = async () => ({ configPath: "/tmp/nexus-test/config.json", async start() {}, async stop() { stopCalls += 1; if (stopCalls === 1) throw new Error("stop failed"); }, async status() { return { running: true }; }, async reload() {}, async logs() { return []; } });
  const controller = createExecutionController({ executionFactory: factory, pathRevalidator: async path => path });
  await controller.prepare(request); await controller.start(); await assert.rejects(controller.stop(), /stop failed/);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.equal(controller.events()[0].type, "execution-failed");
  assert.equal(controller.events()[0].context.reason, "stop-failed");
  await controller.stop(); assert.equal(controller.state, ExecutionStates.IDLE);
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

test("execution controller fails closed when invalidation races kernel start", async () => {
  let listener = null;
  let stopped = 0;
  let started = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() {
        started += 1;
        await listener("gfw-path-revalidation-required");
      },
      async stop() { stopped += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => path,
    sessionInvalidationSource: async callback => {
      listener = callback;
      return async () => { listener = null; };
    }
  });

  await controller.prepare(request);
  await assert.rejects(controller.start(), /gfw-path-revalidation-required/);
  assert.equal(started, 1);
  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /gfw-path-revalidation-required/);
});

test("execution controller fails closed when a running session is invalidated", async () => {
  let listener = null;
  let stopped = 0;
  const factory = async () => ({
    configPath: "/tmp/nexus-test/config.json",
    async start() {},
    async stop() { stopped += 1; },
    async reload() {},
    async status() { return { running: true }; },
    async logs() { return []; }
  });
  const controller = createExecutionController({
    executionFactory: factory,
    pathRevalidator: async path => path,
    sessionInvalidationSource: async callback => {
      listener = callback;
      return async () => { listener = null; };
    }
  });
  await controller.prepare(request);
  await controller.start();
  assert.equal(controller.state, ExecutionStates.RUNNING);
  await listener("network-generation-changed");
  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /network-generation-changed/);
});


test("execution controller ignores invalidation before the session is running", async () => {
  let listener = null;
  let stops = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({ configPath: "/tmp/nexus-test/config.json", async start() {}, async stop() { stops += 1; }, async reload() {}, async status() { return { running: false }; }, async logs() {} }),
    pathRevalidator: async path => path,
    sessionInvalidationSource: async callback => { listener = callback; return async () => { listener = null; }; }
  });
  await controller.prepare(request);
  await listener("network-generation-changed");
  assert.equal(controller.state, ExecutionStates.READY);
  assert.equal(stops, 0);
  await controller.stop();
});

test("execution controller deduplicates concurrent session invalidation", async () => {
  let listener = null;
  let resolveStop;
  let stops = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() {},
      async stop() { stops += 1; await new Promise(resolve => { resolveStop = resolve; }); },
      async reload() {},
      async status() { return { running: true }; },
      async logs() {}
    }),
    pathRevalidator: async path => path,
    sessionInvalidationSource: async callback => { listener = callback; return async () => { listener = null; }; }
  });
  await controller.prepare(request);
  await controller.start();
  const first = listener("network-generation-changed");
  const second = listener("path-trust-invalidated");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveStop, "function");
  resolveStop();
  await Promise.all([first, second]);
  assert.equal(stops, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /network-generation-changed/);
});

test("execution controller fails closed after reload failure and stops the kernel", async () => {
  let stops = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() {},
      async stop() { stops += 1; },
      async reload() { throw new Error("reload failed"); },
      async status() { return { running: true }; },
      async logs() {}
    }),
    pathRevalidator: async path => path
  });
  await controller.prepare(request);
  await controller.start();
  await assert.rejects(controller.reload(), /reload failed/);
  assert.equal(stops, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.equal((await controller.status()).execution, null);
  assert.equal(controller.events()[0].type, "execution-failed");
  assert.equal(controller.events()[0].context.reason, "reload-failed");
});


test("execution controller fails closed when reload invalidates the network path", async () => {
  let stopped = 0;
  let validationCount = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() {},
      async stop() { stopped += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() {}
    }),
    pathRevalidator: async () => ({ validated: true, networkGeneration: validationCount++ === 0 ? 1 : 2 })
  });
  await controller.prepare({ ...request, path: { validated: true, networkGeneration: 1 } });
  await controller.start();
  await assert.rejects(controller.reload(), /execution path changed after reload/);
  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /execution path changed after reload/);
});

test("execution controller records security evidence when a session is invalidated", async () => {
  const events = [];
  let stopped = 0;
  let invalidate = null;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/audit.json",
      async start() {},
      async stop() { stopped += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() {}
    }),
    pathRevalidator: async path => path,
    sessionInvalidationSource: async listener => {
      invalidate = listener;
      return async () => { invalidate = null; };
    },
    eventSink: async (type, context) => { events.push({ type, context }); }
  });
  await controller.prepare({
    decision: { id: "audit-session-001", version: 2, action: "routing", choice: "proxy", requiresUserChoice: true, confirmed: false },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, nodes: [] },
    userAuthorized: true,
    security: { preflightPassed: true, failClosed: true },
    path: { validated: true, networkGeneration: 0 }
  });
  await controller.start();
  await invalidate({
    reason: "gfw-path-revalidation-required",
    state: "suspected",
    signals: ["tcp-reset", "tls-sni-failure"],
    actions: ["revalidate-path"],
    score: 3.5,
    confidence: 0.72
  });
  assert.equal(stopped, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "session-invalidated");
  assert.deepEqual(events[0].context, {
    reason: "gfw-path-revalidation-required",
    kernel: Kernels.SING_BOX,
    decisionId: "audit-session-001",
    decisionVersion: 2,
    state: ExecutionStates.STOPPING,
    evidence: {
      state: "suspected",
      signals: ["tcp-reset", "tls-sni-failure"],
      actions: ["revalidate-path"],
      score: 3.5,
      confidence: 0.72
    }
  });
  assert.equal(invalidate, null);
});


test("execution controller enforces optional path trust before kernel start", async () => {
  let starts = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() { starts += 1; },
      async stop() {},
      async reload() {},
      async status() { return { running: false }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => ({ ...path, routeId: "route-2" })
  });

  const trustedPath = {
    validated: true,
    networkId: "net-1",
    networkGeneration: 1,
    routeId: "route-1",
    dnsPathId: "dns-1",
    destinationId: "dest-1",
    transport: "tls",
    certificateId: "cert-1",
    bootstrapId: "boot-1",
    trust: {
      expected: {
        networkId: "net-1",
        networkGeneration: 1,
        routeId: "route-1",
        dnsPathId: "dns-1",
        destinationId: "dest-1",
        transport: "tls"
      }
    }
  };

  await controller.prepare({ ...request, path: trustedPath });
  await assert.rejects(controller.start(), /path trust validation failed/);
  assert.equal(starts, 0);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.equal(controller.events()[0].type, "path-trust-rejected");
});

test("execution controller starts when optional path trust remains consistent", async () => {
  let starts = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/config.json",
      async start() { starts += 1; },
      async stop() {},
      async reload() {},
      async status() { return { running: true }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => ({ ...path })
  });

  const path = {
    validated: true,
    networkId: "net-1",
    networkGeneration: 1,
    routeId: "route-1",
    dnsPathId: "dns-1",
    destinationId: "dest-1",
    transport: "tls",
    certificateId: "cert-1",
    bootstrapId: "boot-1",
    trust: {
      expected: {
        networkId: "net-1",
        networkGeneration: 1,
        routeId: "route-1",
        dnsPathId: "dns-1",
        destinationId: "dest-1",
        transport: "tls"
      }
    }
  };

  await controller.prepare({ ...request, path });
  await controller.start();
  assert.equal(starts, 1);
  assert.equal(controller.state, ExecutionStates.RUNNING);
  await controller.stop();
});
