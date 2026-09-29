import test from "node:test";
import assert from "node:assert/strict";
import { createGfwRuntime, GfwSignals } from "../src/core/gfw-policy.js";
import { createPathTrustSession, PathTrustStates } from "../src/core/path-trust.js";
import { bindGfwPathTrust } from "../src/core/gfw-path-trust.js";
import { createExecutionController, ExecutionStates } from "../src/core/execution-controller.js";
import { Kernels } from "../src/core/model.js";

test("GFW revalidation evidence invalidates the kernel-neutral path trust session", () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  const baseline = {
    networkId: "wifi-1",
    networkGeneration: 1,
    routeId: "route-1",
    dnsPathId: "dns-1",
    destinationId: "dest-1",
    transport: "tcp",
    certificateId: "cert-1",
    bootstrapId: "boot-1"
  };

  pathTrust.establish(baseline);
  assert.equal(pathTrust.snapshot().invalidated, false);

  const unsubscribe = bindGfwPathTrust(gfw, pathTrust);
  const evidence = gfw.observe({ signal: GfwSignals.TCP_RESET, transport: "tcp" }, 100000);

  assert.ok(evidence.actions.includes("revalidate-path"));
  assert.equal(pathTrust.snapshot().invalidated, true);

  const snapshot = pathTrust.snapshot();
  assert.equal(snapshot.expected.routeId, "route-1");
  unsubscribe();
});

test("GFW path-trust binding rejects invalid inputs", () => {
  const gfw = createGfwRuntime();
  assert.throws(() => bindGfwPathTrust(null, createPathTrustSession()), /GFW runtime/);
  assert.throws(() => bindGfwPathTrust(gfw, null), /path trust session/);
});

test("GFW-triggered invalidation uses fail-closed path trust state", () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  pathTrust.establish({
    networkId: "n1",
    networkGeneration: 1,
    routeId: "r1",
    dnsPathId: "d1",
    destinationId: "x1",
    transport: "tls",
    certificateId: "c1",
    bootstrapId: "b1"
  });

  bindGfwPathTrust(gfw, pathTrust);
  gfw.observe({ signal: GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE }, 100000);

  const result = pathTrust.validate({
    networkId: "n1",
    networkGeneration: 1,
    routeId: "r1",
    dnsPathId: "d1",
    destinationId: "x1",
    transport: "tls",
    certificateId: "c1",
    bootstrapId: "b1"
  });

  assert.equal(result.trusted, true);
  assert.equal(pathTrust.snapshot().invalidated, false);
  assert.equal(result.state, PathTrustStates.TRUSTED);
});

test("GFW invalidation propagates through path trust into the running execution controller", async () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  pathTrust.establish({
    networkId: "n1",
    networkGeneration: 1,
    routeId: "r1",
    dnsPathId: "d1",
    destinationId: "x1",
    transport: "tls",
    certificateId: "c1",
    bootstrapId: "b1"
  });

  const unsubscribeGfw = bindGfwPathTrust(gfw, pathTrust);
  let stopped = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/gfw-path-trust-controller.json",
      async start() {},
      async stop() { stopped += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => ({ ...path, validated: true }),
    sessionInvalidationSource: pathTrust.subscribeInvalidation
  });

  await controller.prepare({
    decision: {
      id: "gfw-path-trust-001",
      version: 1,
      action: "routing",
      choice: "proxy",
      requiresUserChoice: true,
      confirmed: false
    },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, nodes: [] },
    userAuthorized: true,
    security: { preflightPassed: true, failClosed: true },
    path: {
      validated: true,
      networkGeneration: 1,
      trust: {
        expected: pathTrust.snapshot().expected,
        observed: pathTrust.snapshot().expected
      }
    }
  });

  await controller.start();
  assert.equal(controller.state, ExecutionStates.RUNNING);

  gfw.observe({ signal: GfwSignals.TCP_RESET, transport: "tls" }, 100000);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /gfw:/);

  unsubscribeGfw();
});

test("GFW clock rollback propagates through path trust into a running execution controller", async () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  const baseline = {
    networkId: "n-clock",
    networkGeneration: 7,
    routeId: "r-clock",
    dnsPathId: "d-clock",
    destinationId: "x-clock",
    transport: "tls",
    certificateId: "c-clock",
    bootstrapId: "b-clock"
  };
  pathTrust.establish(baseline);
  const unsubscribeGfw = bindGfwPathTrust(gfw, pathTrust);
  let stopped = 0;
  const controller = createExecutionController({
    executionFactory: async () => ({
      configPath: "/tmp/nexus-test/gfw-clock-rollback.json",
      async start() {},
      async stop() { stopped += 1; },
      async reload() {},
      async status() { return { running: true }; },
      async logs() { return []; }
    }),
    pathRevalidator: async path => ({ ...path, validated: true }),
    sessionInvalidationSource: pathTrust.subscribeInvalidation
  });

  await controller.prepare({
    decision: { id: "gfw-clock-001", version: 1, action: "routing", choice: "proxy", requiresUserChoice: true, confirmed: false },
    kernel: Kernels.SING_BOX,
    config: { kernel: Kernels.SING_BOX, nodes: [] },
    userAuthorized: true,
    security: { preflightPassed: true, failClosed: true },
    path: { validated: true, networkGeneration: 7, trust: { expected: baseline, observed: baseline } }
  });

  await controller.start();
  assert.equal(controller.state, ExecutionStates.RUNNING);

  gfw.snapshot(100000);
  gfw.snapshot(99000);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(stopped, 1);
  assert.equal(controller.state, ExecutionStates.FAILED);
  assert.match(controller.snapshot().failure, /gfw-path-revalidation-required/);
  unsubscribeGfw();
});
