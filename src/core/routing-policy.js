import { evaluateParallelMatchSet, resolveParallelRoutingDecision } from "./parallel-rule-engine.js";

export const RoutingMatchTypes = Object.freeze([
  "domain",
  "domain_suffix",
  "domain_keyword",
  "ip_cidr",
  "source_ip_cidr",
  "port",
  "source_port",
  "network",
  "protocol",
  "geoip",
  "geosite",
  "rule_set",
  "process_name",
  "process_path",
  "package_name",
  "inbound",
  "interface",
  "logical"
]);

export const RoutingActions = Object.freeze([
  "route",
  "reject",
  "dns",
  "bypass",
  "chain"
]);

export const RoutingStrategyTypes = Object.freeze([
  "manual",
  "selector",
  "url_test",
  "fallback",
  "load_balance"
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(field + " must be a non-empty string");
  }
  return value.trim();
}

function normalizeMatch(match) {
  if (!match || typeof match !== "object" || Array.isArray(match)) {
    throw new TypeError("routing rule match must be an object");
  }

  const normalized = {};
  for (const type of RoutingMatchTypes) {
    if (match[type] !== undefined) normalized[type] = clone(match[type]);
  }

  if (!Object.keys(normalized).length) {
    throw new Error("routing rule requires at least one match condition");
  }

  return normalized;
}

function normalizeAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) {
    throw new TypeError("routing rule action must be an object");
  }

  const type = nonEmptyString(action.type, "routing action type").toLowerCase();
  if (!RoutingActions.includes(type)) {
    throw new Error("unsupported routing action: " + type);
  }

  const normalized = { type };

  if (type === "route" || type === "bypass") {
    normalized.target = nonEmptyString(action.target, "routing action target");
  }

  if (type === "chain") {
    if (action.target !== undefined && action.target !== null && text(action.target)) {
      normalized.target = text(action.target);
    }
    if (!Array.isArray(action.hops) || action.hops.length < 2) {
      throw new Error("routing chain action requires at least two hops");
    }
    normalized.hops = clone(action.hops);
  }

  if (type === "dns") {
    normalized.target = nonEmptyString(action.target, "routing DNS target");
  }

  return normalized;
}

export function createRoutingRule({
  id,
  name,
  match,
  action,
  enabled = true,
  order = 0,
  metadata = {}
} = {}) {
  return Object.freeze({
    id: nonEmptyString(id, "routing rule id"),
    name: nonEmptyString(name, "routing rule name"),
    enabled: enabled !== false,
    // Retained as presentation/editing metadata for compatibility. It has no
    // effect on parallel rule evaluation or action resolution.
    order: Number.isInteger(order) ? order : 0,
    match: Object.freeze(normalizeMatch(match)),
    action: Object.freeze(normalizeAction(action)),
    metadata: Object.freeze(clone(metadata) || {})
  });
}

export function createRoutingPolicy({
  mode = "rule",
  rules = [],
  strategies = [],
  defaultAction = { type: "route", target: "default" }
} = {}) {
  if (!["rule", "global_proxy", "global_bypass"].includes(mode)) {
    throw new Error("unsupported routing mode: " + mode);
  }

  const normalizedRules = rules
    .map((rule) => rule && rule.id ? createRoutingRule(rule) : rule)
    .filter(Boolean);

  return {
    version: 1,
    mode,
    rules: normalizedRules,
    strategies: strategies.map(clone),
    defaultAction: normalizeAction(defaultAction)
  };
}

export function resolveRoutingPolicyDecision(policy, flow, matchesRule) {
  if (!policy || typeof policy !== "object") throw new TypeError("routing policy is required");

  if (policy.mode === "global_proxy") {
    const action = { type: "route", target: "global_proxy" };
    return Object.freeze({
      status: "global",
      action,
      ruleIds: Object.freeze([]),
      reason: "global-proxy-policy",
      evidence: Object.freeze({ mode: policy.mode, flow: clone(flow || {}) })
    });
  }

  if (policy.mode === "global_bypass") {
    const action = { type: "bypass", target: "direct" };
    return Object.freeze({
      status: "global",
      action,
      ruleIds: Object.freeze([]),
      reason: "global-bypass-policy",
      evidence: Object.freeze({ mode: policy.mode, flow: clone(flow || {}) })
    });
  }

  const matchSet = evaluateParallelMatchSet(policy.rules, flow, matchesRule);
  const decision = resolveParallelRoutingDecision(matchSet, policy.defaultAction);
  const matches = matchSet.matches.map((item) => Object.freeze({
    ruleId: item.ruleId,
    ruleIndex: item.ruleIndex,
    match: clone(item.match),
    action: clone(item.action)
  }));

  return Object.freeze({
    ...decision,
    evidence: Object.freeze({
      mode: policy.mode,
      flow: clone(flow || {}),
      matches: Object.freeze(matches)
    })
  });
}

export function validateRoutingPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== "object") {
    return { ok: false, errors: ["routing policy must be an object"] };
  }

  if (policy.version !== 1) errors.push("unsupported routing policy version");
  if (!["rule", "global_proxy", "global_bypass"].includes(policy.mode)) {
    errors.push("unsupported routing mode");
  }
  if (!Array.isArray(policy.rules)) errors.push("routing rules must be an array");
  if (!Array.isArray(policy.strategies)) errors.push("routing strategies must be an array");

  if (Array.isArray(policy.rules)) {
    const ids = new Set();
    for (const rule of policy.rules) {
      try {
        const normalized = createRoutingRule(rule);
        if (ids.has(normalized.id)) errors.push("duplicate routing rule id: " + normalized.id);
        ids.add(normalized.id);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  try {
    normalizeAction(policy.defaultAction);
  } catch (error) {
    errors.push(error.message);
  }

  return { ok: errors.length === 0, errors };
}
