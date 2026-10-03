import { calculateRulePackageChecksum, validateRulePackage } from "./rule-library.js";

export const RULE_VERSION_POLICY_VERSION = 1;

function identityFor(pkg) {
  return pkg.publisher + ":" + pkg.id;
}

function normalizeRecord(record) {
  return Object.freeze({
    publisher: record.publisher,
    id: record.id,
    version: record.version,
    checksum: record.checksum,
    acceptedAt: record.acceptedAt || null
  });
}

export function createRuleVersionState(records = []) {
  if (!Array.isArray(records)) throw new Error("rule version records must be an array");
  const byIdentity = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") throw new Error("rule version record is invalid");
    if (typeof record.publisher !== "string" || !record.publisher.trim()) throw new Error("rule version publisher is required");
    if (typeof record.id !== "string" || !record.id.trim()) throw new Error("rule version id is required");
    if (!Number.isInteger(record.version) || record.version < 1) throw new Error("rule version is invalid");
    if (typeof record.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(record.checksum)) {
      throw new Error("rule version checksum must be SHA-256");
    }
    const identity = record.publisher.trim() + ":" + record.id.trim();
    if (byIdentity.has(identity)) throw new Error("duplicate rule version identity: " + identity);
    byIdentity.set(identity, normalizeRecord({
      publisher: record.publisher.trim(),
      id: record.id.trim(),
      version: record.version,
      checksum: record.checksum.toLowerCase(),
      acceptedAt: record.acceptedAt
    }));
  }
  return { schemaVersion: RULE_VERSION_POLICY_VERSION, records: byIdentity };
}

export function exportRuleVersionState(state) {
  if (!state || !(state.records instanceof Map)) throw new Error("rule version state is invalid");
  return Object.freeze([...state.records.values()].map(normalizeRecord));
}

export async function inspectRulePackageVersion(pkg, state, { checksum = null } = {}) {
  validateRulePackage(pkg);
  if (!state || !(state.records instanceof Map)) throw new Error("rule version state is invalid");
  const calculatedChecksum = checksum || await calculateRulePackageChecksum(pkg);
  const identity = identityFor(pkg);
  const current = state.records.get(identity);
  if (!current) return Object.freeze({ ok: true, action: "first-seen", identity, version: pkg.version, checksum: calculatedChecksum });
  if (pkg.version < current.version) {
    return Object.freeze({ ok: false, action: "stale-version", identity, currentVersion: current.version, candidateVersion: pkg.version });
  }
  if (pkg.version === current.version) {
    if (calculatedChecksum.toLowerCase() !== current.checksum) {
      return Object.freeze({ ok: false, action: "version-conflict", identity, version: pkg.version, currentChecksum: current.checksum, candidateChecksum: calculatedChecksum });
    }
    return Object.freeze({ ok: true, action: "same-version", identity, version: pkg.version, checksum: calculatedChecksum });
  }
  return Object.freeze({ ok: true, action: "upgrade", identity, currentVersion: current.version, candidateVersion: pkg.version, checksum: calculatedChecksum });
}

export async function acceptRulePackageVersion(pkg, state, options = {}) {
  const decision = await inspectRulePackageVersion(pkg, state, options);
  if (!decision.ok) {
    const error = new Error("rule package version rejected: " + decision.action + ": " + pkg.id);
    error.code = "NEXUS_RULE_VERSION_REJECTED";
    error.decision = decision;
    throw error;
  }
  if (decision.action !== "same-version") {
    state.records.set(decision.identity, normalizeRecord({
      publisher: pkg.publisher,
      id: pkg.id,
      version: pkg.version,
      checksum: decision.checksum,
      acceptedAt: new Date().toISOString()
    }));
  }
  return decision;
}
