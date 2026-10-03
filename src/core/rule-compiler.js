import { Kernels } from "./model.js";
import { mergeRulePackages, compileRulesForKernel, assertRulePackagesTrusted } from "./rule-library.js";

const MATCH_FIELDS = Object.freeze({
  domain: "domain",
  "domain-suffix": "domain_suffix",
  "domain-keyword": "domain_keyword",
  "ip-cidr": "ip_cidr",
  geo: "geosite",
  application: "package_name",
  process: "process_name",
  port: "port",
  protocol: "protocol"
});

function targetFor(action, targets) {
  if (action === "reject") return null;
  const target = targets?.[action];
  if (typeof target !== "string" || !target.trim()) {
    throw new Error("rule action requires a configured target: " + action);
  }
  return target.trim();
}

function toRoutingRule(rule, targets) {
  const matchField = MATCH_FIELDS[rule.matchType];
  if (!matchField) throw new Error("unsupported rule match type: " + rule.matchType);
  const match = { [matchField]: rule.value };
  switch (rule.action) {
    case "reject":
      return { id: rule.id, name: rule.id, enabled: true, match, action: { type: "reject" }, priority: rule.priority ?? 0 };
    case "direct":
      return { id: rule.id, name: rule.id, enabled: true, match, action: { type: "bypass", target: targetFor("direct", targets) }, priority: rule.priority ?? 0 };
    case "proxy":
      return { id: rule.id, name: rule.id, enabled: true, match, action: { type: "route", target: targetFor("proxy", targets) }, priority: rule.priority ?? 0 };
    case "chain":
      return { id: rule.id, name: rule.id, enabled: true, match, action: { type: "chain", target: targetFor("chain", targets) }, priority: rule.priority ?? 0 };
    case "dns":
      return { id: rule.id, name: rule.id, enabled: true, match, action: { type: "dns", target: targetFor("dns", targets) }, priority: rule.priority ?? 0 };
    case "tun":
      throw new Error("rule action 'tun' requires a kernel-specific TUN policy and cannot be silently compiled as routing: " + rule.id);
    default:
      throw new Error("unsupported rule action: " + rule.action);
  }
}

export function compileRulePackagesForKernel(packages, kernel, { targets = {} } = {}) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return Object.freeze({ kernel, schemaVersion: 1, rules: Object.freeze([]), routing: Object.freeze([]) });
  }
  if (!Object.values(Kernels).includes(kernel)) throw new Error("unsupported kernel: " + kernel);
  assertRulePackagesTrusted(packages);
  const merged = mergeRulePackages(packages);
  const unified = compileRulesForKernel(merged, kernel);
  const routing = unified.rules
    .map((rule) => toRoutingRule(rule, targets))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id));
  return Object.freeze({
    kernel,
    schemaVersion: unified.schemaVersion,
    rules: unified.rules,
    routing: Object.freeze(routing)
  });
}
