const RULE_LIBRARY_VERSION = 1;

export const RULE_ACTIONS = Object.freeze([
  "direct",
  "proxy",
  "reject",
  "dns",
  "tun",
  "chain"
]);

export const RULE_MATCH_TYPES = Object.freeze([
  "domain",
  "domain-suffix",
  "domain-keyword",
  "ip-cidr",
  "geo",
  "application",
  "process",
  "port",
  "protocol"
]);

export const RULE_SOURCES = Object.freeze([
  "builtin",
  "platform",
  "user",
  "external"
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
}

export function canonicalRulePackagePayload(pkg) {
  const copy = clone(pkg);
  delete copy.checksum;
  delete copy.signature;
  return stableStringify(copy);
}

export async function calculateRulePackageChecksum(pkg) {
  const payload = new TextEncoder().encode(canonicalRulePackagePayload(pkg));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function assertString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("rule package " + field + " is required");
  }
  return value.trim();
}

function validateRule(rule, index) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
    throw new Error("rule[" + index + "] must be an object");
  }
  if (!SAFE_ID.test(String(rule.id || ""))) throw new Error("rule[" + index + "] has invalid id");
  if (!RULE_MATCH_TYPES.includes(rule.matchType)) {
    throw new Error("rule[" + index + "] has unsupported matchType");
  }
  if (!RULE_ACTIONS.includes(rule.action)) {
    throw new Error("rule[" + index + "] has unsupported action");
  }
  if (typeof rule.value !== "string" || rule.value.trim() === "") {
    throw new Error("rule[" + index + "] value is required");
  }
  if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 100000)) {
    throw new Error("rule[" + index + "] priority is invalid");
  }
}

export function validateRulePackage(pkg) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    throw new Error("rule package must be an object");
  }
  if (!SAFE_ID.test(String(pkg.id || ""))) throw new Error("rule package id is invalid");
  if (!Number.isInteger(pkg.version) || pkg.version < 1) throw new Error("rule package version is invalid");
  if (!Number.isInteger(pkg.schemaVersion) || pkg.schemaVersion !== RULE_LIBRARY_VERSION) {
    throw new Error("unsupported rule package schemaVersion");
  }
  if (!RULE_SOURCES.includes(pkg.source)) throw new Error("unsupported rule package source");
  assertString(pkg.publisher, "publisher");
  assertString(pkg.createdAt, "createdAt");
  assertString(pkg.updatedAt, "updatedAt");
  if (!Array.isArray(pkg.rules) || pkg.rules.length === 0) throw new Error("rule package rules are required");
  pkg.rules.forEach(validateRule);

  if (pkg.checksum !== undefined && !SHA256.test(String(pkg.checksum))) {
    throw new Error("rule package checksum must be SHA-256");
  }

  if (pkg.signature !== undefined) {
    if (!pkg.signature || typeof pkg.signature !== "object") throw new Error("rule package signature is invalid");
    assertString(pkg.signature.algorithm, "signature.algorithm");
    assertString(pkg.signature.keyId, "signature.keyId");
    assertString(pkg.signature.value, "signature.value");
  }

  return true;
}

export async function verifyRulePackage(pkg, {
  allowedPublishers = [],
  verifySignature = null,
  expectedChecksum = null
} = {}) {
  validateRulePackage(pkg);

  const publisherAllowed = allowedPublishers.length === 0 || allowedPublishers.includes(pkg.publisher);
  const calculatedChecksum = await calculateRulePackageChecksum(pkg);
  const checksumMatches = !pkg.checksum || pkg.checksum.toLowerCase() === calculatedChecksum;
  const expectedMatches = !expectedChecksum || expectedChecksum.toLowerCase() === calculatedChecksum;

  let signatureVerified = pkg.signature === undefined;
  if (pkg.signature && typeof verifySignature === "function") {
    signatureVerified = await verifySignature({
      algorithm: pkg.signature.algorithm,
      keyId: pkg.signature.keyId,
      value: pkg.signature.value,
      payload: canonicalRulePackagePayload(pkg)
    });
  }

  return Object.freeze({
    ok: publisherAllowed && checksumMatches && expectedMatches && signatureVerified,
    publisherAllowed,
    checksumMatches,
    expectedMatches,
    signaturePresent: pkg.signature !== undefined,
    signatureVerified,
    calculatedChecksum
  });
}

const SOURCE_PRIORITY = Object.freeze({
  builtin: 400,
  user: 300,
  platform: 200,
  external: 100
});

export function mergeRulePackages(packages = []) {
  const accepted = packages.slice().sort((a, b) =>
    (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0)
  );
  const byId = new Map();

  for (const pkg of accepted) {
    validateRulePackage(pkg);
    for (const rule of pkg.rules) {
      const current = byId.get(rule.id);
      const currentRank = current ? SOURCE_PRIORITY[current.source] || 0 : -1;
      const nextRank = SOURCE_PRIORITY[pkg.source] || 0;
      if (!current || nextRank > currentRank || (nextRank === currentRank && pkg.version >= current.version)) {
        byId.set(rule.id, {
          ...clone(rule),
          source: pkg.source,
          packageId: pkg.id,
          packageVersion: pkg.version
        });
      }
    }
  }

  return Object.freeze([...byId.values()].sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id)
  ));
}

export function compileRulesForKernel(rules, kernel) {
  if (!["mihomo", "sing-box", "xray"].includes(kernel)) {
    throw new Error("unsupported kernel: " + kernel);
  }
  return Object.freeze({
    kernel,
    schemaVersion: RULE_LIBRARY_VERSION,
    rules: clone(rules)
  });
}

export function getRuleLibraryVersion() {
  return RULE_LIBRARY_VERSION;
}
