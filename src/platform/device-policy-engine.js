/**
 * AngelaNexus Device Policy Engine
 *
 * Platform-neutral policy evaluation. Platform adapters resolve identities;
 * this layer only evaluates explicit user/system policy and produces a
 * deterministic route decision for kernel execution.
 */

const ACTIONS = Object.freeze(["direct", "proxy", "block", "chain"]);
const MATCH_TYPES = Object.freeze(["device", "app", "domain", "cidr", "protocol", "port", "default"]);

function assertString(value, name) {
  if (!value || typeof value !== "string") throw new TypeError(`${name} must be a non-empty string`);
}

function normalizeList(value) {
  return Array.isArray(value) ? [...new Set(value.filter(Boolean).map(String))] : [];
}

function specificity(rule) {
  const order = { app: 50, device: 40, domain: 30, cidr: 25, protocol: 20, port: 10, default: 0 };
  return order[rule.matchType] ?? -1;
}

function matches(rule, context) {
  const values = context[rule.matchType];
  if (rule.matchType === "default") return true;
  if (Array.isArray(values)) return values.includes(rule.value);
  return values === rule.value;
}

export class DevicePolicyEngine {
  constructor({ policies = [], systemDefaults = [], clock = () => new Date() } = {}) {
    this.clock = clock;
    this.policies = [];
    this.systemDefaults = [];
    this.replacePolicies(policies);
    this.replaceSystemDefaults(systemDefaults);
  }

  validateRule(rule) {
    if (!rule || typeof rule !== "object") throw new TypeError("policy rule must be an object");
    assertString(rule.id, "policy.id");
    if (!MATCH_TYPES.includes(rule.matchType)) throw new TypeError("unsupported policy.matchType");
    if (!ACTIONS.includes(rule.action)) throw new TypeError("unsupported policy.action");
    if (rule.matchType !== "default") assertString(rule.value, "policy.value");
    if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 0)) {
      throw new TypeError("policy.priority must be a non-negative integer");
    }
    if (rule.source && !["user", "system"].includes(rule.source)) throw new TypeError("policy.source must be user or system");
    return {
      ...rule,
      source: rule.source ?? "user",
      priority: rule.priority ?? 0,
      enabled: rule.enabled !== false,
    };
  }

  replacePolicies(policies) {
    if (!Array.isArray(policies)) throw new TypeError("policies must be an array");
    this.policies = policies.map((p) => this.validateRule({ ...p, source: "user" }));
  }

  replaceSystemDefaults(policies) {
    if (!Array.isArray(policies)) throw new TypeError("systemDefaults must be an array");
    this.systemDefaults = policies.map((p) => this.validateRule({ ...p, source: "system" }));
  }

  evaluate(context = {}) {
    const candidates = [...this.policies, ...this.systemDefaults]
      .filter((rule) => rule.enabled && matches(rule, context))
      .sort((a, b) =>
        (b.priority - a.priority) ||
        (specificity(b) - specificity(a)) ||
        (a.source === b.source ? 0 : a.source === "user" ? -1 : 1) ||
        a.id.localeCompare(b.id)
      );

    const selected = candidates[0] ?? null;
    const decisionId = `route-${this.clock().getTime()}`;

    if (!selected) {
      return {
        decisionId,
        action: "direct",
        selectedPolicyId: null,
        source: "implicit-default",
        matchedPolicyIds: [],
        conflict: false,
      };
    }

    const sameRank = candidates.filter((rule) =>
      rule.priority === selected.priority && specificity(rule) === specificity(selected)
    );
    const conflicting = sameRank.some((rule) => rule.action !== selected.action);
    if (conflicting) {
      return {
        decisionId,
        action: "block",
        selectedPolicyId: selected.id,
        source: "conflict-fail-closed",
        matchedPolicyIds: sameRank.map((rule) => rule.id),
        conflict: true,
      };
    }

    return {
      decisionId,
      action: selected.action,
      target: selected.target ?? null,
      selectedPolicyId: selected.id,
      source: selected.source,
      matchedPolicyIds: candidates.map((rule) => rule.id),
      conflict: false,
    };
  }
}

export const DEVICE_POLICY_ACTIONS = ACTIONS;
export const DEVICE_POLICY_MATCH_TYPES = MATCH_TYPES;
