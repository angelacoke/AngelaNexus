import { validateUnifiedCompatibility } from "./compatibility.js";
import { getKernelSchema } from "./schema-registry.js";
import { getKernelUpstream } from "./kernel-registry.js";
import { validateSystemSecurityPolicy } from "./system-security-policy.js";

function diagnostic(code, severity, message, details = {}) {
  return Object.freeze({ code, severity, message, ...details });
}

const BUILTIN_TARGETS = new Set(["DIRECT", "direct", "REJECT", "reject", "Nexus-Direct", "Nexus-Blackhole", "Nexus-DNS"]);

function items(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (value && typeof value === "object") return Object.values(value).filter((item) => item && typeof item === "object");
  return [];
}

function targetNames(value) {
  const names = new Set();
  for (const item of items(value)) {
    for (const field of ["id", "name", "tag"]) {
      const value = item[field];
      if (typeof value === "string" && value.trim()) names.add(value.trim());
    }
  }
  return names;
}

function validateRoutingTargets(config) {
  const routing = config && config.routing;
  if (!routing || typeof routing !== "object") return [];

  const nodes = targetNames(config.nodes);
  const groups = targetNames(config.groups);
  const chains = targetNames(config.chains);
  const strategies = targetNames(routing.strategies);
  const validTargets = new Set([...nodes, ...groups, ...chains, ...strategies, ...BUILTIN_TARGETS]);
  const errors = [];

  function check(action, location) {
    if (!action || typeof action !== "object") return;
    const type = action.type;
    if (type === "chain") {
      // Chain existence and hop validity are resolved by chain-resolution.js.
      // Preflight must not replace its established diagnostics with a generic target error.
      return;
    }
    if (type !== "route") return;
    const target = typeof action.target === "string" ? action.target.trim() : "";
    if (!target) return;
    if (!validTargets.has(target)) {
      errors.push(diagnostic(
        "ROUTING_TARGET_UNRESOLVED",
        "error",
        "routing references missing node or group: " + target,
        { target, location }
      ));
    }
  }

  check(routing.defaultAction, "routing.defaultAction");
  if (Array.isArray(routing.rules)) {
    routing.rules.forEach((rule, index) => {
      if (rule && rule.enabled !== false) check(rule.action, `routing.rules[${index}].action`);
    });
  }
  return errors;
}

export function preflightUnifiedConfig(config, kernel = config && config.kernel) {
  if (!config || typeof config !== "object") {
    const d = diagnostic("CONFIG_INVALID", "error", "unified configuration is required");
    return { ok: false, kernel: kernel || null, errors: [d], warnings: [], diagnostics: [d] };
  }

  const errors = [];
  const warnings = [];
  try {
    const upstream = getKernelUpstream(kernel);
    const schema = getKernelSchema(kernel, upstream.stable);
    const compatibility = validateUnifiedCompatibility(config, kernel);
    const security = validateSystemSecurityPolicy(config);

    for (const item of security.errors) errors.push(diagnostic(item.code, "error", item.message, { key: item.key, value: item.value }));
    errors.push(...validateRoutingTargets(config));
    for (const item of compatibility.unsupported) errors.push(diagnostic("PROTOCOL_UNSUPPORTED", "error", "node protocol is unsupported", { id: item.id, protocol: item.protocol, reason: item.reason }));
    for (const item of compatibility.unknown) errors.push(diagnostic("PROTOCOL_UNKNOWN", "error", "node protocol compatibility is not established", { id: item.id, protocol: item.protocol, reason: item.reason }));
    for (const item of compatibility.constraintErrors) errors.push(diagnostic(item.code || "COMBINATION_UNSUPPORTED", "error", item.message || "node combination is unsupported", { id: item.id || null }));
    for (const item of compatibility.featureErrors) errors.push(diagnostic("FEATURE_UNSUPPORTED", "error", "kernel feature combination is unsupported", { id: item.id || null, feature: item.feature, protocol: item.protocol, transport: item.transport, reason: item.reason }));
    for (const item of compatibility.featureUnknown) errors.push(diagnostic("FEATURE_UNKNOWN", "error", "kernel feature capability is not established", { id: item.id || null, feature: item.feature, protocol: item.protocol, transport: item.transport, reason: item.reason }));
    for (const item of compatibility.warnings) warnings.push(diagnostic(item.code || "COMPATIBILITY_WARNING", "warning", item.message || "compatibility warning", { id: item.id || null }));

    return { ok: errors.length === 0, kernel, version: upstream.stable, schemaId: schema.schemaId, compatibility, security, errors, warnings, diagnostics: errors.concat(warnings) };
  } catch (error) {
    const d = diagnostic("PREFLIGHT_FAILED", "error", error.message);
    return { ok: false, kernel: kernel || null, errors: [d], warnings, diagnostics: [d] };
  }
}
