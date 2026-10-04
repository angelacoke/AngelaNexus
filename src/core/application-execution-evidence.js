import { applicationIdentityKey, createApplicationIdentity } from "./application-identity.js";

export const APPLICATION_EXECUTION_EVIDENCE_VERSION = 1;

const ACTIONS = new Set(["direct", "proxy", "reject", "bypass", "route", "chain"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(value, fallback = null) {
  const v = text(value);
  return v ? v.slice(0, 256) : fallback;
}

/**
 * Joins the policy winner, scoped driver, transport backend and verification
 * result into privacy-minimized execution evidence. It never stores payloads,
 * credentials, proxy secrets or complete user configuration.
 */
export function createApplicationExecutionEvidence(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("execution evidence input is required");
  if (!input.identity || typeof input.identity !== "object") throw new TypeError("execution evidence requires application identity");

  const identity = createApplicationIdentity(input.identity);
  const policy = input.policy && typeof input.policy === "object" ? input.policy : {};
  const driver = input.driver && typeof input.driver === "object" ? input.driver : {};
  const verification = input.verification && typeof input.verification === "object" ? input.verification : {};

  const action = text(policy.action) || "direct";
  if (!ACTIONS.has(action)) throw new Error("unsupported application routing action: " + action);

  const verified = verification.status === "verified";
  const decisionId = safeId(input.decisionId || policy.decisionId);
  const kernel = safeId(input.kernel || input.backend);
  const evidence = Object.freeze({
    version: APPLICATION_EXECUTION_EVIDENCE_VERSION,
    decisionId,
    identityKey: applicationIdentityKey(identity),
    platform: identity.platform,
    application: safeId(identity.packageName || identity.bundleId || identity.executable || identity.processName),
    process: safeId(identity.processName),
    scope: safeId(input.scope || "application"),
    action,
    ruleId: safeId(policy.ruleId),
    matched: policy.matched === true,
    driver: safeId(driver.id),
    kernel,
    executionStatus: safeId(input.executionStatus || (driver.id ? "planned" : "unbound")),
    verificationStatus: safeId(verification.status || "unverified"),
    verificationReason: safeId(verification.reason),
    verified,
  });

  return evidence;
}

export function recordApplicationExecutionEvidence(ledger, input = {}) {
  if (!ledger || typeof ledger.record !== "function") throw new TypeError("execution ledger is required");
  const evidence = createApplicationExecutionEvidence(input);
  return ledger.record("application-execution", {
    decisionId: evidence.decisionId,
    kernel: evidence.kernel,
    state: evidence.executionStatus,
    evidence: {
      state: evidence.verificationStatus,
      signals: [
        "application:" + evidence.identityKey,
        "scope:" + evidence.scope,
        "action:" + evidence.action,
        evidence.ruleId ? "rule:" + evidence.ruleId : "rule:none",
        evidence.driver ? "driver:" + evidence.driver : "driver:none",
        evidence.kernel ? "kernel:" + evidence.kernel : "kernel:none",
        "verification:" + evidence.verificationStatus,
      ],
      actions: [evidence.verified ? "egress-verified" : "egress-unverified"],
      confidence: evidence.verified ? 1 : 0,
    },
  });
}
