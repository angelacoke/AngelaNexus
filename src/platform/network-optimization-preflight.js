import { NetworkConditions, isSafeForLossCompensation } from "./network-condition-classifier.js";

export const NETWORK_OPTIMIZATION_PREFLIGHT_VERSION = 1;

export const OptimizationActions = Object.freeze({
  NONE: "none",
  CONSERVATIVE: "conservative",
  LOSS_COMPENSATION: "loss-compensation",
});

export function evaluateNetworkOptimizationPreflight({
  classification,
  requestedAction = OptimizationActions.NONE,
  capabilityVerified = false,
  securityHealthy = false,
} = {}) {
  if (!classification || typeof classification !== "object") {
    return Object.freeze({ ok: false, action: OptimizationActions.NONE, reason: "missing-classification" });
  }
  if (securityHealthy !== true) {
    return Object.freeze({ ok: false, action: OptimizationActions.NONE, reason: "security-not-healthy" });
  }
  if (capabilityVerified !== true) {
    return Object.freeze({ ok: false, action: OptimizationActions.NONE, reason: "optimization-capability-not-verified" });
  }
  if (requestedAction === OptimizationActions.LOSS_COMPENSATION) {
    if (!isSafeForLossCompensation(classification)) {
      return Object.freeze({ ok: false, action: OptimizationActions.NONE, reason: "loss-compensation-condition-not-proven" });
    }
    return Object.freeze({
      version: NETWORK_OPTIMIZATION_PREFLIGHT_VERSION,
      ok: true,
      action: OptimizationActions.LOSS_COMPENSATION,
      reason: "high-confidence-random-loss",
    });
  }
  if (requestedAction === OptimizationActions.CONSERVATIVE) {
    if (classification.condition === NetworkConditions.QUEUE_CONGESTION || classification.condition === NetworkConditions.UNKNOWN) {
      return Object.freeze({ ok: false, action: OptimizationActions.NONE, reason: "condition-unsafe-for-optimization" });
    }
    return Object.freeze({ version: NETWORK_OPTIMIZATION_PREFLIGHT_VERSION, ok: true, action: OptimizationActions.CONSERVATIVE, reason: "conservative-condition-match" });
  }
  return Object.freeze({ version: NETWORK_OPTIMIZATION_PREFLIGHT_VERSION, ok: true, action: OptimizationActions.NONE, reason: "no-optimization-requested" });
}
