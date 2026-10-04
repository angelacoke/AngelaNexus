import { createDecisionRecord } from "./decision-registry.js";
import { createExecutionContract } from "./execution-contract.js";
import { createUnifiedKernelSelection } from "./unified-kernel-selection.js";

export const DecisionPlanVersion = 1;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

function assertEvidence(input) {
  if (!input || typeof input !== "object") throw new TypeError("decision planning input is required");
  if (!input.route || typeof input.route !== "object") throw new TypeError("route decision evidence is required");
  if (!input.path || input.path.validated !== true) throw new Error("decision planning requires a validated path");
  if (!input.security || input.security.preflightPassed !== true) throw new Error("decision planning requires security preflight");
  if (input.security.failClosed !== true) throw new Error("decision planning requires fail-closed security mode");
}

function deriveAction(route) {
  if (route.chain === true || Array.isArray(route.hops)) return "chain";
  if (route.bypass === true || route.mode === "direct") return "bypass";
  return "routing";
}

function deriveChoice(route) {
  if (route.chain === true || Array.isArray(route.hops)) {
    return Object.freeze({ mode: "chain", hops: Array.isArray(route.hops) ? route.hops : [] });
  }
  if (route.bypass === true || route.mode === "direct") return Object.freeze({ mode: "direct" });
  return Object.freeze({ mode: text(route.mode) || "proxy", target: text(route.target) || null });
}

export function createExecutionDecision(input = {}) {
  assertEvidence(input);
  const action = deriveAction(input.route);
  const choice = deriveChoice(input.route);
  const id = text(input.id);
  if (!id) throw new Error("execution decision id is required");

  return createDecisionRecord({
    id,
    action,
    choice,
    version: DecisionPlanVersion,
    confirmed: input.confirmed === true,
    context: freeze({
      routeEvidence: input.route,
      pathEvidence: input.path,
      gfwEvidence: input.gfw || null,
      securityEvidence: input.security
    })
  });
}

export function createPlannedExecutionContract(input = {}) {
  const decision = createExecutionDecision(input);
  if (!input.kernel) throw new Error("execution planning requires a kernel");
  if (!input.config || input.config.kernel !== input.kernel) {
    throw new Error("execution planning requires a config matching the selected kernel");
  }
  return createExecutionContract({
    ...input,
    decision,
    userAuthorized: input.userAuthorized === true
  });
}


export function createKernelAwareExecutionContract(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("kernel-aware execution input is required");
  const node = input.node || input.config?.node;
  if (!node) throw new Error("kernel-aware execution requires a node");
  if (typeof input.configFactory !== "function") {
    throw new TypeError("kernel-aware execution requires a configFactory");
  }

  const selection = createUnifiedKernelSelection(node, {
    ...input,
    kernel: input.kernel,
  });
  if (!selection.ok || !selection.selected?.kernel) {
    throw new Error("kernel selection failed: " + selection.reason);
  }

  const kernel = selection.selected.kernel;
  const config = input.configFactory(kernel, node, selection);
  if (!config || typeof config !== "object") {
    throw new Error("configFactory must return a configuration object");
  }
  if (config.kernel !== kernel) {
    throw new Error("configFactory returned a config for a different kernel");
  }

  const contract = createPlannedExecutionContract({
    ...input,
    kernel,
    config,
  });

  return Object.freeze({
    contract,
    kernelSelection: selection,
  });
}

export function validateDecisionPlan(input = {}) {
  try {
    return Object.freeze({ ok: true, decision: createExecutionDecision(input), errors: Object.freeze([]) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      decision: null,
      errors: Object.freeze([error instanceof Error ? error.message : String(error)])
    });
  }
}

export function validatePlannedExecutionContract(input = {}) {
  try {
    return Object.freeze({ ok: true, contract: createPlannedExecutionContract(input), errors: Object.freeze([]) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      contract: null,
      errors: Object.freeze([error instanceof Error ? error.message : String(error)])
    });
  }
}
