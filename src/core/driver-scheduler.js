import { missingCapabilities, normalizeCapabilities } from "../adapters/capability-negotiation.js";

export const DriverSelectionStatus = Object.freeze({
  SELECTED: "selected",
  UNSUPPORTED: "unsupported",
  REJECTED: "rejected"
});

const HEALTH_ORDER = Object.freeze({
  active: 0,
  ready: 1,
  available: 2,
  idle: 3,
  suspended: 4,
  degraded: 5,
  unknown: 6,
  unavailable: 7,
  failed: 8
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function healthRank(driver) {
  const state = text(driver?.health?.state || driver?.state || "unknown").toLowerCase();
  return HEALTH_ORDER[state] ?? HEALTH_ORDER.unknown;
}

function evaluateDriver(driver, plan, requiredCapabilities) {
  const missing = missingCapabilities(driver?.capabilities, requiredCapabilities);
  if (missing.length) {
    return Object.freeze({
      driver: driver?.id || null,
      eligible: false,
      status: "missing-capabilities",
      missingCapabilities: Object.freeze([...missing]),
      reason: "required capabilities are not available"
    });
  }

  try {
    if (["failed", "unavailable", "suspended"].includes(text(driver?.health?.state || driver?.state || "unknown").toLowerCase())) {
      return Object.freeze({
        driver: driver.id,
        eligible: false,
        status: "unavailable",
        missingCapabilities: Object.freeze([]),
        reason: "driver is not currently executable in its lifecycle state"
      });
    }

    if (typeof driver?.canExecute !== "function" || driver.canExecute(plan) !== true) {
      return Object.freeze({
        driver: driver?.id || null,
        eligible: false,
        status: "cannot-execute",
        missingCapabilities: Object.freeze([]),
        reason: "driver rejected the execution plan"
      });
    }

    let match = null;
    if (typeof driver.match === "function") {
      match = driver.match(plan);
      if (match === false || match?.eligible === false) {
        return Object.freeze({
          driver: driver.id,
          eligible: false,
          status: "capability-mismatch",
          missingCapabilities: Object.freeze(Array.isArray(match?.missingCapabilities) ? [...match.missingCapabilities] : []),
          reason: text(match?.reason) || "driver capability matcher rejected the plan"
        });
      }
    }

    const preference = match?.preference === "preferred" ? "preferred" : "compatible";
    return Object.freeze({
      driver: driver.id,
      eligible: true,
      status: preference,
      missingCapabilities: Object.freeze([]),
      reason: text(match?.reason) || "required capabilities and execution constraints are satisfied"
    });
  } catch (error) {
    return Object.freeze({
      driver: driver?.id || null,
      eligible: false,
      status: "evaluation-error",
      missingCapabilities: Object.freeze([]),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function orderCandidates(candidates, preferredIds) {
  const preference = new Map(preferredIds.map((id, index) => [id, index]));
  return [...candidates].sort((left, right) => {
    const leftPreference = preference.has(left.driver.id) ? preference.get(left.driver.id) : Number.MAX_SAFE_INTEGER;
    const rightPreference = preference.has(right.driver.id) ? preference.get(right.driver.id) : Number.MAX_SAFE_INTEGER;
    if (leftPreference !== rightPreference) return leftPreference - rightPreference;

    const leftMatch = left.evaluation.status === "preferred" ? 0 : 1;
    const rightMatch = right.evaluation.status === "preferred" ? 0 : 1;
    if (leftMatch !== rightMatch) return leftMatch - rightMatch;

    const leftHealth = healthRank(left.driver);
    const rightHealth = healthRank(right.driver);
    if (leftHealth !== rightHealth) return leftHealth - rightHealth;

    return left.driver.id.localeCompare(right.driver.id);
  });
}

export function createDriverSelection(input = {}) {
  const drivers = Array.isArray(input.drivers) ? input.drivers.filter(Boolean) : [];
  const plan = input.plan && typeof input.plan === "object" ? input.plan : null;
  if (!plan) throw new TypeError("driver selection requires an execution plan");

  const requiredCapabilities = normalizeCapabilities(input.requiredCapabilities);
  const allowedDrivers = input.allowedDrivers === undefined
    ? null
    : new Set(normalizeCapabilities(input.allowedDrivers));
  const fixedDriver = text(input.fixedDriver);
  const preferredDrivers = normalizeCapabilities(input.preferredDrivers);

  const candidates = [];
  const rejected = [];

  for (const driver of drivers) {
    if (!text(driver.id)) {
      rejected.push(Object.freeze({ driver: null, status: "invalid-driver", reason: "driver id is required" }));
      continue;
    }
    if (allowedDrivers && !allowedDrivers.has(driver.id)) {
      rejected.push(Object.freeze({ driver: driver.id, status: "user-disallowed", reason: "driver is outside the allowed driver set" }));
      continue;
    }
    if (fixedDriver && driver.id !== fixedDriver) {
      rejected.push(Object.freeze({ driver: driver.id, status: "fixed-driver-policy", reason: "another driver is explicitly fixed by user policy" }));
      continue;
    }

    const evaluation = evaluateDriver(driver, plan, requiredCapabilities);
    if (evaluation.eligible) candidates.push({ driver, evaluation });
    else rejected.push(evaluation);
  }

  if (!candidates.length) {
    return Object.freeze({
      status: fixedDriver ? DriverSelectionStatus.REJECTED : DriverSelectionStatus.UNSUPPORTED,
      selected: null,
      candidates: Object.freeze([]),
      rejected: Object.freeze(rejected),
      fallback: Object.freeze({
        allowed: false,
        candidates: Object.freeze([])
      }),
      explanation: fixedDriver
        ? "The fixed driver cannot satisfy the execution plan; automatic fallback is not permitted."
        : "No available driver satisfies the execution plan and current user policy."
    });
  }

  const ordered = orderCandidates(candidates, preferredDrivers);
  const selected = ordered[0];
  const fallbackAllowed = input.allowFailover === true && !fixedDriver;

  return Object.freeze({
    status: DriverSelectionStatus.SELECTED,
    selected: Object.freeze({
      id: selected.driver.id,
      reason: selected.evaluation.reason,
      match: selected.evaluation.status,
      health: text(selected.driver?.health?.state || selected.driver?.state || "unknown") || "unknown"
    }),
    candidates: Object.freeze(ordered.map(({ driver, evaluation }) => Object.freeze({
      id: driver.id,
      match: evaluation.status,
      health: text(driver?.health?.state || driver?.state || "unknown") || "unknown",
      reason: evaluation.reason
    }))),
    rejected: Object.freeze(rejected),
    fallback: Object.freeze({
      allowed: fallbackAllowed,
      candidates: fallbackAllowed ? Object.freeze(ordered.slice(1).map(({ driver }) => driver.id)) : Object.freeze([])
    }),
    explanation: fixedDriver
      ? "The user-fixed driver satisfies the execution plan and was selected."
      : "The selected driver satisfies the required capabilities; explicit preferences, capability match, health state, and stable driver identity were used in that order."
  });
}

export function selectDriver(input = {}) {
  return createDriverSelection(input).selected?.id || null;
}
