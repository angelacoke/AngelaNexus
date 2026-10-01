/**
 * AngelaNexus platform-level parallel rule semantics.
 *
 * Rules are evaluated as a set of independent predicates. The platform
 * collects every provable match and lets the policy layer resolve the
 * resulting Match Set. Kernel adapters remain execution backends.
 */

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeScalar(value) {
  return String(value ?? "").trim().toLowerCase();
}

function valuesOf(value) {
  if (Array.isArray(value)) return value.map(normalizeScalar).filter(Boolean);
  const normalized = normalizeScalar(value);
  return normalized ? [normalized] : [];
}

function domainValues(match) {
  const values = [];
  for (const type of ["domain", "domain_suffix"]) {
    for (const value of valuesOf(match && match[type])) {
      values.push({ type, value: value.replace(/^\\./, "") });
    }
  }
  return values;
}

function domainInSuffix(domain, suffix) {
  return domain === suffix || domain.endsWith("." + suffix);
}

function domainRelation(left, right) {
  const a = domainValues(left);
  const b = domainValues(right);
  for (const leftValue of a) {
    for (const rightValue of b) {
      if (leftValue.type === "domain" && rightValue.type === "domain" &&
          leftValue.value === rightValue.value) return "identical";
      if (leftValue.type === "domain" && rightValue.type === "domain_suffix" &&
          domainInSuffix(leftValue.value, rightValue.value)) return "contained";
      if (leftValue.type === "domain_suffix" && rightValue.type === "domain" &&
          domainInSuffix(rightValue.value, leftValue.value)) return "contains";
      if (leftValue.type === "domain_suffix" && rightValue.type === "domain_suffix") {
        if (domainInSuffix(leftValue.value, rightValue.value)) return "contains";
        if (domainInSuffix(rightValue.value, leftValue.value)) return "contained";
      }
    }
  }
  return null;
}

function withoutDomain(match) {
  const copy = clone(match || {});
  delete copy.domain;
  delete copy.domain_suffix;
  return copy;
}

function sameNonDomainPredicates(left, right) {
  return JSON.stringify(withoutDomain(left)) === JSON.stringify(withoutDomain(right));
}

function matchRelation(left, right) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return "unknown";
  const exact = JSON.stringify(left) === JSON.stringify(right);
  if (exact) return "identical";
  if (!sameNonDomainPredicates(left, right)) return "unknown";
  return domainRelation(left, right) || "disjoint";
}

/**
 * Analyze relationships between enabled platform rules.
 *
 * This function deliberately does not expose rule priority and does not
 * reorder rules. Relationship analysis is informational; policy resolution
 * happens separately from kernel compilation.
 */
export function analyzeRuleRelationships(routing) {
  const rules = routing && Array.isArray(routing.rules) ? routing.rules : [];
  const relationships = [];

  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    const left = rules[leftIndex];
    if (!left || typeof left !== "object" || left.enabled === false || !left.match || !left.action) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const right = rules[rightIndex];
      if (!right || typeof right !== "object" || right.enabled === false || !right.match || !right.action) continue;

      const relation = matchRelation(left.match, right.match);
      if (relation === "unknown" || relation === "disjoint") continue;
      if (JSON.stringify(left.action) === JSON.stringify(right.action)) continue;

      relationships.push({
        type: relation === "identical" ? "identical-match" : "overlapping-match",
        leftRuleId: left.id || null,
        leftRuleIndex: leftIndex,
        rightRuleId: right.id || null,
        rightRuleIndex: rightIndex,
        relation,
      });
    }
  }

  return relationships;
}

/**
 * Evaluate one concrete flow against platform rules in parallel.
 *
 * A rule matcher is injected by the caller so platform identity detection
 * can evolve independently from this deterministic Match Set container.
 * Every enabled rule is considered; no first-match short circuit exists.
 */
export function evaluateParallelMatchSet(rules, flow, matchesRule) {
  const source = Array.isArray(rules) ? rules : [];
  const matcher = typeof matchesRule === "function" ? matchesRule : () => false;
  const matches = [];

  for (let index = 0; index < source.length; index += 1) {
    const rule = source[index];
    if (!rule || typeof rule !== "object" || rule.enabled === false) continue;
    if (!matcher(rule.match || {}, flow, rule, index)) continue;
    matches.push({
      ruleId: rule.id || null,
      ruleIndex: index,
      match: clone(rule.match || {}),
      action: clone(rule.action || null),
    });
  }

  return {
    ruleIds: matches.map((item) => item.ruleId).filter(Boolean),
    matches,
  };
}
