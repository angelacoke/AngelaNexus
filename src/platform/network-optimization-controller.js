import { classifyNetworkCondition } from "./network-condition-classifier.js";
import {
  evaluateNetworkOptimizationPreflight,
  OptimizationActions,
} from "./network-optimization-preflight.js";
import {
  createTransparentLifecycle,
  TransparentLifecycleStates,
} from "./transparent-lifecycle.js";

export const NETWORK_OPTIMIZATION_CONTROLLER_VERSION = 1;

function normalizeRequestedAction(action) {
  return Object.values(OptimizationActions).includes(action)
    ? action
    : OptimizationActions.NONE;
}

export function createNetworkOptimizationController({
  lifecycle = createTransparentLifecycle(),
  userEnabled = false,
  requestedAction = OptimizationActions.NONE,
} = {}) {
  let enabled = Boolean(userEnabled);
  let requested = normalizeRequestedAction(requestedAction);
  let activeAction = OptimizationActions.NONE;
  let lastDecision = null;
  let lastClassification = null;

  function snapshot() {
    return Object.freeze({
      version: NETWORK_OPTIMIZATION_CONTROLLER_VERSION,
      userEnabled: enabled,
      requestedAction: requested,
      activeAction,
      classification: lastClassification,
      decision: lastDecision,
      lifecycle: lifecycle.snapshot(),
    });
  }

  function setUserEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) requested = OptimizationActions.NONE;
    return snapshot();
  }

  function setRequestedAction(action) {
    requested = normalizeRequestedAction(action);
    return snapshot();
  }

  function evaluate({ telemetry = {}, capabilityVerified = false, securityHealthy = false } = {}) {
    lastClassification = classifyNetworkCondition(telemetry);
    const requestedAction = enabled ? requested : OptimizationActions.NONE;
    lastDecision = evaluateNetworkOptimizationPreflight({
      classification: lastClassification,
      requestedAction,
      capabilityVerified,
      securityHealthy,
    });
    return Object.freeze({
      ...lastDecision,
      userEnabled: enabled,
      requestedAction,
      classification: lastClassification,
    });
  }

  function apply({ telemetry = {}, capabilityVerified = false, securityHealthy = false, healthCheck = () => true, optimizationExecutor = null } = {}) {
    const decision = evaluate({ telemetry, capabilityVerified, securityHealthy });
    if (!decision.ok) return Object.freeze({ ok: false, phase: "preflight", decision, snapshot: snapshot() });

    if (decision.action === activeAction) {
      return Object.freeze({ ok: true, phase: "unchanged", action: activeAction, decision, snapshot: snapshot() });
    }

    if (typeof optimizationExecutor !== "function") {
      return Object.freeze({
        ok: false,
        phase: "executor",
        reason: "optimization-executor-not-bound",
        decision,
        snapshot: snapshot(),
      });
    }

    const before = lifecycle.snapshot();
    if (before.state !== TransparentLifecycleStates.ACTIVE || before.activeBackend === null) {
      return Object.freeze({
        ok: false,
        phase: "lifecycle",
        reason: "transparent-runtime-not-active",
        decision,
        snapshot: snapshot(),
      });
    }

    try {
      lifecycle.beginDrain();
      lifecycle.markDrained();
      lifecycle.beginActivation(before.activeBackend);
      const execution = optimizationExecutor({
        action: decision.action,
        classification: decision.classification,
        previousAction: activeAction,
      });
      const executionSucceeded =
        execution === true ||
        (execution !== null &&
          typeof execution === "object" &&
          execution.ok === true);
      if (!executionSucceeded) throw new Error("optimization executor rejected activation");
      const healthy = healthCheck({
        action: decision.action,
        previousAction: activeAction,
        classification: decision.classification,
      }) === true;
      if (!healthy) {
        lifecycle.rollback("optimization-health-check-failed");
        lifecycle.recover();
        return Object.freeze({
          ok: false,
          phase: "health-check",
          reason: "optimization-health-check-failed",
          action: activeAction,
          decision,
          snapshot: snapshot(),
        });
      }
      lifecycle.activate();
      activeAction = decision.action;
      return Object.freeze({
        ok: true,
        phase: "activated",
        action: activeAction,
        decision,
        snapshot: snapshot(),
      });
    } catch (error) {
      try {
        if (lifecycle.snapshot().state === TransparentLifecycleStates.ACTIVATING) {
          lifecycle.rollback("optimization-activation-failed");
          lifecycle.recover();
        }
      } catch {
        lifecycle.fail("optimization-activation-failed");
      }
      return Object.freeze({
        ok: false,
        phase: "lifecycle",
        reason: "optimization-activation-failed",
        error: error instanceof Error ? error.message : String(error),
        decision,
        snapshot: snapshot(),
      });
    }
  }

  return Object.freeze({
    snapshot,
    setUserEnabled,
    setRequestedAction,
    evaluate,
    apply,
  });
}
