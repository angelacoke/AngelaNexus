/**
 * AngelaNexus Network Control Plane
 *
 * Connects identity/context, policy evaluation, lifecycle management and the
 * network acceptance harness. Platform and kernel operations remain injected
 * adapters; this layer never calls platform APIs directly.
 */

import { DevicePolicyEngine } from "./device-policy-engine.js";
import { NetworkLifecycle } from "./network-lifecycle.js";
import { NetworkAcceptanceHarness } from "./network-acceptance-harness.js";

function requireObject(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(name + " is required");
}

function requireFn(value, name) {
  if (typeof value !== "function") throw new TypeError(name + " must be a function");
}

export function createNetworkControlPlane({
  policyEngine = new DevicePolicyEngine(),
  lifecycle,
  acceptanceHarness,
  evidenceStore,
  kernelAdapter,
  clock = () => new Date(),
} = {}) {
  requireObject(lifecycle, "lifecycle");
  requireObject(kernelAdapter, "kernelAdapter");
  requireFn(kernelAdapter.prepare, "kernelAdapter.prepare");
  requireFn(kernelAdapter.apply, "kernelAdapter.apply");
  requireFn(kernelAdapter.liveVerify, "kernelAdapter.liveVerify");
  requireFn(kernelAdapter.trafficAcceptance, "kernelAdapter.trafficAcceptance");
  requireFn(kernelAdapter.rollback, "kernelAdapter.rollback");
  requireFn(kernelAdapter.cleanupVerify, "kernelAdapter.cleanupVerify");
  requireFn(kernelAdapter.capabilityGate, "kernelAdapter.capabilityGate");
  if (typeof lifecycle.transition !== "function") throw new TypeError("lifecycle.transition must be a function");
  if (typeof lifecycle.recover !== "function") throw new TypeError("lifecycle.recover must be a function");
  if (typeof lifecycle.restore !== "function") throw new TypeError("lifecycle.restore must be a function");

  const harness = acceptanceHarness || new NetworkAcceptanceHarness({
    capabilityGate: kernelAdapter.capabilityGate,
    prepare: async scenario => kernelAdapter.prepare(scenario, currentDecision),
    apply: async (transaction, scenario) => kernelAdapter.apply(transaction, scenario, currentDecision),
    liveVerify: async (transaction, scenario) => kernelAdapter.liveVerify(transaction, scenario, currentDecision),
    trafficAcceptance: async (transaction, scenario) => kernelAdapter.trafficAcceptance(transaction, scenario, currentDecision),
    rollback: async (transaction, scenario) => kernelAdapter.rollback(transaction, scenario, currentDecision),
    cleanupVerify: async (transaction, scenario) => kernelAdapter.cleanupVerify(transaction, scenario, currentDecision),
    evidenceStore,
    clock,
  });

  if (typeof harness.run !== "function") throw new TypeError("acceptanceHarness.run must be a function");

  let currentDecision = null;
  let activeScenario = null;

  async function evaluate(context = {}) {
    return policyEngine.evaluate(context);
  }

  async function execute(scenario, context = {}, options = {}) {
    if (!scenario || typeof scenario !== "object") throw new TypeError("scenario is required");
    currentDecision = await evaluate(context);
    activeScenario = Object.freeze({
      ...scenario,
      decisionId: scenario.decisionId || currentDecision.decisionId,
    });

    if (currentDecision.action === "block") {
      const evidence = {
        scenarioId: activeScenario.id,
        decisionId: currentDecision.decisionId,
        timestamp: clock().toISOString(),
        result: "rejected",
        failureClass: "routing-conflict",
        verificationState: "failed",
        evidenceSource: "network-control-plane",
      };
      if (evidenceStore) await evidenceStore.record(evidence);
      return Object.freeze({ decision: currentDecision, acceptance: evidence });
    }

    await lifecycle.transition("preparing", {
      reason: "control-plane-execution",
      scenarioId: activeScenario.id,
      decisionId: currentDecision.decisionId,
      verified: true,
    });

    let acceptance;
    try {
      await lifecycle.transition("applying", {
        reason: "acceptance-harness-apply",
        scenarioId: activeScenario.id,
        decisionId: currentDecision.decisionId,
        verified: false,
      });
      acceptance = await harness.run(activeScenario, options);
      if (acceptance.result === "rejected") {
        await lifecycle.transition("stopped", {
          reason: acceptance.failureClass || "execution-rejected",
          scenarioId: activeScenario.id,
          decisionId: currentDecision.decisionId,
          verified: acceptance.verificationState === "failed",
        });
      } else if (acceptance.result === "success") {
        await lifecycle.transition("running", {
          reason: "verified-network-acceptance",
          scenarioId: activeScenario.id,
          decisionId: currentDecision.decisionId,
          verified: true,
        });
      } else if (acceptance.result === "degraded") {
        await lifecycle.transition("degraded", {
          reason: acceptance.failureClass || "degraded-acceptance",
          scenarioId: activeScenario.id,
          decisionId: currentDecision.decisionId,
          verified: false,
        });
      } else {
        await lifecycle.recover({
          reason: acceptance.failureClass || "acceptance-failed",
          scenarioId: activeScenario.id,
          decisionId: currentDecision.decisionId,
        });
        if (acceptance.cleanupVerify?.verified === true) {
          await lifecycle.restore({
            reason: "rollback-cleanup-verified",
            scenarioId: activeScenario.id,
            decisionId: currentDecision.decisionId,
          });
        }
      }
      return Object.freeze({ decision: currentDecision, acceptance });
    } catch (error) {
      if (lifecycle.snapshot().state !== "recovering") {
        try {
          await lifecycle.recover({
            reason: error instanceof Error ? error.message : String(error),
            scenarioId: activeScenario.id,
            decisionId: currentDecision.decisionId,
          });
        } catch {}
      }
      throw error;
    } finally {
      currentDecision = null;
      activeScenario = null;
    }
  }

  return Object.freeze({
    evaluate,
    execute,
    getActiveDecision: () => currentDecision,
    getActiveScenario: () => activeScenario,
  });
}

export { DevicePolicyEngine, NetworkLifecycle, NetworkAcceptanceHarness };
