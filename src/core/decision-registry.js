import { getUserChoicePolicy, requiresUserConfirmation } from "./user-choice-policy.js";

const AUTO_ACTIONS = Object.freeze([
  "detectFormat",
  "detectProtocol",
  "detectKernelCompatibility",
  "validateConfig",
  "diagnoseNode",
  "measureLatency",
  "reportSecurityRisk"
]);

const USER_DECISIONS = Object.freeze([
  "kernel",
  "kernelUpgrade",
  "nodeLimit",
  "nodeSelection",
  "routing",
  "chain",
  "bypass",
  "networkMode",
  "securityMode",
  "resourceMode",
  "backgroundMonitoring",
  "healthCheckInterval",
  "telemetryLevel",
  "logLevel",
  "connectionIdleTimeout",
  "dnsCachePolicy",
  "ruleSetRefreshPolicy"
]);

export function getDecisionRegistry() {
  return Object.freeze({
    autoActions: AUTO_ACTIONS,
    userDecisions: USER_DECISIONS,
    confirmationActions: getUserChoicePolicy().requireConfirmationFor
  });
}

export function canDecideAutomatically(action) {
  return AUTO_ACTIONS.includes(action) && !requiresUserConfirmation(action);
}

function freezeOption(option) {
  if (option !== null && typeof option === "object") return Object.freeze({ ...option });
  return option;
}

export function createDecisionPrompt(action, options = [], context = {}) {
  const userControlled = USER_DECISIONS.includes(action) || requiresUserConfirmation(action);
  return Object.freeze({
    action,
    requiresUserChoice: userControlled,
    options: Object.freeze(options.map(freezeOption)),
    context: Object.freeze({ ...context }),
    message: userControlled
      ? "Nexus will present available options, explain their effects, and wait for the user's choice."
      : "Nexus may perform this diagnostic action automatically without changing the user's selected operating policy."
  });
}

export function assertUserChoice(action, choice) {
  if (!USER_DECISIONS.includes(action) && !requiresUserConfirmation(action)) return choice;
  if (choice === undefined || choice === null || choice === "") {
    throw new Error("explicit user choice required for: " + action);
  }
  return choice;
}

export function createDecisionRecord({ id, action, choice, version = 1, confirmed = false, context = {} } = {}) {
  if (typeof id !== "string" || !id.trim()) throw new TypeError("decision id must be a non-empty string");
  if (typeof action !== "string" || !action.trim()) throw new TypeError("decision action must be a non-empty string");
  const requiresChoice = USER_DECISIONS.includes(action) || requiresUserConfirmation(action);
  assertUserChoice(action, choice);
  if (requiresUserConfirmation(action) && confirmed !== true) {
    throw new Error("explicit confirmation required for: " + action);
  }
  if (!Number.isInteger(version) || version < 1) throw new TypeError("decision version must be a positive integer");
  return Object.freeze({
    id: id.trim(),
    version,
    action: action.trim(),
    choice,
    requiresUserChoice: requiresChoice,
    confirmed: confirmed === true,
    context: Object.freeze({ ...context })
  });
}
