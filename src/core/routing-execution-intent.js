import { RoutingActions } from "./routing-policy.js";

export const ROUTING_EXECUTION_INTENT_VERSION = 1;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

function requireTarget(action, value) {
  const target = text(value);
  if (!target) throw new Error("routing execution intent requires a target for " + action);
  return target;
}

function normalizeHops(hops) {
  if (!Array.isArray(hops) || hops.length < 2) {
    throw new Error("routing execution intent chain requires at least two hops");
  }
  return hops.map((hop, index) => {
    if (typeof hop === "string") return hop.trim();
    if (!hop || typeof hop !== "object") throw new TypeError("routing execution intent hop " + index + " is invalid");
    const node = text(hop.node || hop.id || hop.target);
    if (!node) throw new Error("routing execution intent hop " + index + " requires a node reference");
    return freeze({ ...clone(hop), node });
  });
}

export function createRoutingExecutionIntent(decision, context = {}) {
  if (!decision || typeof decision !== "object") {
    throw new TypeError("routing decision is required");
  }

  const action = text(decision.action?.type || decision.action);
  if (!RoutingActions.includes(action)) {
    throw new Error("unsupported routing decision action: " + action);
  }

  let mode;
  let target = null;
  let hops = null;

  if (action === "route") {
    mode = "proxy";
    target = requireTarget(action, decision.action?.target);
  } else if (action === "bypass") {
    mode = "direct";
    target = requireTarget(action, decision.action?.target);
  } else if (action === "reject") {
    mode = "reject";
  } else if (action === "chain") {
    mode = "chain";
    hops = normalizeHops(decision.action?.hops || context.hops);
  } else if (action === "dns") {
    mode = "dns";
    target = requireTarget(action, decision.action?.target);
  }

  return Object.freeze({
    version: ROUTING_EXECUTION_INTENT_VERSION,
    kind: "routing-execution-intent",
    mode,
    action,
    target,
    hops,
    ruleIds: Object.freeze(
      Array.isArray(decision.ruleIds)
        ? decision.ruleIds.map((id) => text(id)).filter(Boolean)
        : []
    ),
    reason: text(decision.reason) || "routing-decision",
    application: context.application ? freeze(clone(context.application)) : null,
    metadata: freeze({
      source: "routing-policy",
      ...(context.metadata && typeof context.metadata === "object" ? clone(context.metadata) : {})
    })
  });
}

export function validateRoutingExecutionIntent(intent) {
  const errors = [];
  try {
    if (!intent || typeof intent !== "object") throw new TypeError("routing execution intent is required");
    if (intent.version !== ROUTING_EXECUTION_INTENT_VERSION) throw new Error("unsupported routing execution intent version");
    if (intent.kind !== "routing-execution-intent") throw new Error("invalid routing execution intent kind");
    if (!["proxy", "direct", "reject", "chain", "dns"].includes(intent.mode)) throw new Error("unsupported routing execution intent mode");

    if (intent.mode === "proxy" || intent.mode === "direct" || intent.mode === "dns") {
      requireTarget(intent.action, intent.target);
    }
    if (intent.mode === "chain") normalizeHops(intent.hops);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
