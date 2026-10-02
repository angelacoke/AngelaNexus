import yaml from "js-yaml";
import { analyzeRuleRelationships } from "./parallel-rule-engine.js";
import { RoutingMatchTypes, RoutingActions } from "./routing-policy.js";

export const RULE_SOURCE_SEMANTIC_VERSION = 1;

export const RULE_SOURCE_SEMANTIC_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxRules: 10000,
  maxNodes: 100000,
  maxDepth: 32,
  maxStringLength: 8192,
  maxArrayLength: 10000,
  maxObjectKeys: 512,
});

const EXECUTABLE_KEYS = new Set([
  "command", "commands", "shell", "script", "scripts", "exec", "execute",
  "eval", "evaluator", "code", "javascript", "function", "module", "require",
  "import", "hook", "hooks", "runtime", "runtime_code"
]);

const ALLOWED_MATCH_KEYS = new Set(RoutingMatchTypes);
const ALLOWED_ACTION_TYPES = new Set(RoutingActions);

function error(code, message, path = "") {
  return { code, message, path };
}

function isContainer(value) {
  if (Array.isArray(value)) return true;
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function guardStructure(root, limits) {
  const stack = [{ value: root, depth: 0, path: "$" }];
  let nodes = 0;

  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > limits.maxNodes) return error("RULE_SOURCE_NODE_LIMIT", "rule source exceeds node limit", current.path);

    const value = current.value;
    if (current.depth > limits.maxDepth) return error("RULE_SOURCE_DEPTH_LIMIT", "rule source exceeds nesting depth", current.path);

    if (typeof value === "string") {
      if (value.length > limits.maxStringLength) {
        return error("RULE_SOURCE_STRING_LIMIT", "rule source string exceeds length limit", current.path);
      }
      continue;
    }

    if (!isContainer(value)) {
      if (value !== null && typeof value !== "number" && typeof value !== "boolean") {
        return error("RULE_SOURCE_VALUE_TYPE", "unsupported rule source value type", current.path);
      }
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length > limits.maxArrayLength) {
        return error("RULE_SOURCE_ARRAY_LIMIT", "rule source array exceeds length limit", current.path);
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: current.depth + 1, path: current.path + "[" + index + "]" });
      }
      continue;
    }

    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys) {
      return error("RULE_SOURCE_OBJECT_LIMIT", "rule source object exceeds key limit", current.path);
    }

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (EXECUTABLE_KEYS.has(key.toLowerCase())) {
        return error("RULE_SOURCE_EXECUTABLE_FIELD", "executable or dynamic-code field is not allowed", current.path + "." + key);
      }
      stack.push({ value: value[key], depth: current.depth + 1, path: current.path + "." + key });
    }
  }

  return null;
}

function parseSource(content) {
  const text = Buffer.from(content).toString("utf8");
  if (!text.trim()) return { ok: false, errors: [error("RULE_SOURCE_EMPTY", "rule source is empty")] };

  try {
    const value = yaml.load(text, { schema: yaml.JSON_SCHEMA, json: false, maxAliasCount: 50 });
    return { ok: true, value };
  } catch (yamlError) {
    return {
      ok: false,
      errors: [error("RULE_SOURCE_PARSE_FAILED", String(yamlError?.message || yamlError))]
    };
  }
}

function extractRules(document) {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== "object" || Array.isArray(document)) return null;
  if (Array.isArray(document.rules)) return document.rules;
  if (document.routing && typeof document.routing === "object" && Array.isArray(document.routing.rules)) {
    return document.routing.rules;
  }
  return null;
}

function validateRule(rule, index) {
  const path = "$.rules[" + index + "]";
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    return [error("RULE_SOURCE_RULE_OBJECT_REQUIRED", "each rule must be an object", path)];
  }

  const errors = [];
  if (typeof rule.id !== "string" || !rule.id.trim()) {
    errors.push(error("RULE_SOURCE_RULE_ID_REQUIRED", "rule id is required", path + ".id"));
  }

  if (!rule.match || typeof rule.match !== "object" || Array.isArray(rule.match)) {
    errors.push(error("RULE_SOURCE_MATCH_REQUIRED", "rule match must be an object", path + ".match"));
  } else {
    for (const key of Object.keys(rule.match)) {
      if (!ALLOWED_MATCH_KEYS.has(key)) {
        errors.push(error("RULE_SOURCE_UNKNOWN_MATCH_TYPE", "unknown rule match type: " + key, path + ".match." + key));
      }
    }
    if (!Object.keys(rule.match).length) {
      errors.push(error("RULE_SOURCE_EMPTY_MATCH", "rule match cannot be empty", path + ".match"));
    }
  }

  if (!rule.action || typeof rule.action !== "object" || Array.isArray(rule.action)) {
    errors.push(error("RULE_SOURCE_ACTION_REQUIRED", "rule action must be an object", path + ".action"));
  } else {
    const type = typeof rule.action.type === "string" ? rule.action.type.trim().toLowerCase() : "";
    if (!ALLOWED_ACTION_TYPES.has(type)) {
      errors.push(error("RULE_SOURCE_UNKNOWN_ACTION_TYPE", "unknown rule action type: " + type, path + ".action.type"));
    }
    if (["route", "chain", "bypass", "dns"].includes(type) &&
        (typeof rule.action.target !== "string" || !rule.action.target.trim())) {
      errors.push(error("RULE_SOURCE_ACTION_TARGET_REQUIRED", "action target is required", path + ".action.target"));
    }
  }

  return errors;
}

function validateSemanticModel(document, limits) {
  const rules = extractRules(document);
  if (!rules) {
    return { ok: false, errors: [error("RULE_SOURCE_RULE_COLLECTION_REQUIRED", "rule source must contain a rules array")] };
  }
  if (rules.length > limits.maxRules) {
    return { ok: false, errors: [error("RULE_SOURCE_RULE_LIMIT", "rule source exceeds rule count limit", "$.rules")] };
  }

  const errors = [];
  for (let index = 0; index < rules.length; index += 1) {
    errors.push(...validateRule(rules[index], index));
    if (errors.length >= 100) break;
  }
  if (errors.length) return { ok: false, errors };

  const relationships = analyzeRuleRelationships({ rules });
  const conflicts = relationships.filter((item) =>
    item.type === "identical-match" || item.type === "overlapping-match"
  );
  if (conflicts.length) {
    return {
      ok: false,
      errors: conflicts.slice(0, 100).map((item) => error(
        "RULE_SOURCE_CONFLICTING_RULES",
        "overlapping rules have conflicting actions",
        "$.rules[" + item.leftRuleIndex + "]"
      ))
    };
  }

  return { ok: true, errors: [], ruleCount: rules.length };
}

export function validateRuleSourceSemantics(content, metadata = {}, options = {}) {
  const limits = { ...RULE_SOURCE_SEMANTIC_LIMITS, ...(options.limits || {}) };
  const bytes = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(String(content ?? ""), "utf8");
  if (bytes > limits.maxBytes) {
    return { ok: false, errors: [error("RULE_SOURCE_SIZE_LIMIT", "rule source exceeds byte limit")] };
  }

  const parsed = parseSource(content);
  if (!parsed.ok) return parsed;

  const structureError = guardStructure(parsed.value, limits);
  if (structureError) return { ok: false, errors: [structureError] };

  const semantic = validateSemanticModel(parsed.value, limits);
  return Object.freeze({
    ...semantic,
    version: RULE_SOURCE_SEMANTIC_VERSION,
    sourceVersion: metadata.version ?? null
  });
}
