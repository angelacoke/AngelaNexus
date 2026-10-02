import test from "node:test";
import assert from "node:assert/strict";
import {
  createNetworkOptimizationController,
} from "../src/platform/network-optimization-controller.js";
import {
  OptimizationActions,
} from "../src/platform/network-optimization-preflight.js";
import {
  createTransparentLifecycle,
  TransparentLifecycleStates,
} from "../src/platform/transparent-lifecycle.js";

function activeLifecycle() {
  const lifecycle = createTransparentLifecycle();
  lifecycle.beginAdmission("test-backend");
  lifecycle.activate();
  return lifecycle;
}

const telemetry = {
  rttMs: 120,
  baseRttMs: 100,
  queueingDelayMs: 2,
  retransmissionRatio: 0.12,
  samples: 20,
};

test("user-disabled optimization never reaches activation", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: false,
    requestedAction: OptimizationActions.LOSS_COMPENSATION,
  });
  const result = controller.apply({
    telemetry,
    capabilityVerified: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.phase, "unchanged");
  assert.equal(result.action, OptimizationActions.NONE);
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});

test("unsafe optimization is blocked before lifecycle drain", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.LOSS_COMPENSATION,
  });
  const result = controller.apply({
    telemetry: {
      rttMs: 300,
      baseRttMs: 100,
      queueingDelayMs: 250,
      retransmissionRatio: 0.3,
      samples: 20,
    },
    capabilityVerified: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "preflight");
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});

test("verified optimization switches through drain and activation", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: {
      rttMs: 120,
      baseRttMs: 100,
      queueingDelayMs: 2,
      samples: 20,
    },
    capabilityVerified: true,
    securityHealthy: true,
    optimizationExecutor: () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.phase, "activated");
  assert.equal(result.action, OptimizationActions.CONSERVATIVE);
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
  assert.equal(lifecycle.snapshot().activeBackend, "test-backend");
});

test("failed optimization health check rolls back to the previous action", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: {
      rttMs: 120,
      baseRttMs: 100,
      queueingDelayMs: 2,
      samples: 20,
    },
    capabilityVerified: true,
    securityHealthy: true,
    optimizationExecutor: () => true,
    healthCheck: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "health-check");
  assert.equal(result.action, OptimizationActions.NONE);
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
  assert.equal(lifecycle.snapshot().activeBackend, "test-backend");
});

test("unverified capability cannot trigger kernel-affecting optimization", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry,
    capabilityVerified: false,
    securityHealthy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "preflight");
  assert.equal(result.decision.reason, "optimization-capability-not-verified");
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});

test("kernel execution boundary is mandatory for optimization activation", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: { rttMs: 120, baseRttMs: 100, queueingDelayMs: 2, samples: 20 },
    capabilityVerified: true,
    securityHealthy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "executor");
  assert.equal(result.reason, "optimization-executor-not-bound");
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});

test("kernel execution boundary must succeed before optimization is committed", () => {
  const lifecycle = activeLifecycle();
  const calls = [];
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: { rttMs: 120, baseRttMs: 100, queueingDelayMs: 2, samples: 20 },
    capabilityVerified: true,
    securityHealthy: true,
    optimizationExecutor: (request) => {
      calls.push(request);
      return true;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, OptimizationActions.CONSERVATIVE);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, OptimizationActions.CONSERVATIVE);
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});


test("health-check failure invokes the kernel rollback boundary", () => {
  const lifecycle = activeLifecycle();
  let rollbackCalls = 0;
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: { rttMs: 120, baseRttMs: 100, queueingDelayMs: 2, samples: 20 },
    capabilityVerified: true,
    securityHealthy: true,
    optimizationExecutor: () => ({
      ok: true,
      rollback: () => {
        rollbackCalls += 1;
      },
    }),
    healthCheck: () => false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "health-check");
  assert.equal(rollbackCalls, 1);
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
});

test("implicit executor success is rejected and rolled back", () => {
  const lifecycle = activeLifecycle();
  const controller = createNetworkOptimizationController({
    lifecycle,
    userEnabled: true,
    requestedAction: OptimizationActions.CONSERVATIVE,
  });
  const result = controller.apply({
    telemetry: { rttMs: 120, baseRttMs: 100, queueingDelayMs: 2, samples: 20 },
    capabilityVerified: true,
    securityHealthy: true,
    optimizationExecutor: () => undefined,
  });
  assert.equal(result.ok, false);
  assert.equal(result.phase, "lifecycle");
  assert.equal(result.reason, "optimization-activation-failed");
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
  assert.equal(lifecycle.snapshot().activeBackend, "test-backend");
});
