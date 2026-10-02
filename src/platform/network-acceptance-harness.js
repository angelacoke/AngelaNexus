/**
 * AngelaNexus Network Acceptance Harness
 *
 * Platform-neutral acceptance state machine. It orchestrates evidence collection
 * but delegates real network operations to injected platform adapters.
 */

const RESULTS = Object.freeze(["success", "degraded", "failure", "rejected"]);
const FAILURE_CLASSES = Object.freeze([
  "capability-unavailable",
  "user-denied",
  "security-failed",
  "verification-failed",
  "routing-conflict",
  "dns-conflict",
  "address-family-failed",
  "path-failed",
  "traffic-failed",
  "cleanup-failed",
  "timeout",
  "unknown",
]);

function requireFn(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
}

function assertScenario(scenario) {
  if (!scenario || typeof scenario !== "object") throw new TypeError("scenario is required");
  for (const key of ["id", "platform", "runtimeMode"]) {
    if (!scenario[key] || typeof scenario[key] !== "string") {
      throw new TypeError(`scenario.${key} is required`);
    }
  }
  if (!Array.isArray(scenario.requiredCapabilities)) {
    throw new TypeError("scenario.requiredCapabilities must be an array");
  }
  return scenario;
}

function classifyFailure(error) {
  const value = typeof error === "string" ? error : error?.failureClass;
  return FAILURE_CLASSES.includes(value) ? value : "unknown";
}

export class NetworkAcceptanceHarness {
  constructor({ capabilityGate, prepare, apply, liveVerify, trafficAcceptance, rollback, cleanupVerify, evidenceStore, clock = () => new Date() }) {
    for (const [name, fn] of Object.entries({ capabilityGate, prepare, apply, liveVerify, trafficAcceptance, rollback, cleanupVerify })) {
      requireFn(fn, name);
    }
    requireFn(evidenceStore?.record, "evidenceStore.record");
    this.capabilityGate = capabilityGate;
    this.prepare = prepare;
    this.apply = apply;
    this.liveVerify = liveVerify;
    this.trafficAcceptance = trafficAcceptance;
    this.rollback = rollback;
    this.cleanupVerify = cleanupVerify;
    this.evidenceStore = evidenceStore;
    this.clock = clock;
  }

  async run(scenario, { userAllowed = true, securityHealthy = true } = {}) {
    assertScenario(scenario);
    const startedAt = this.clock().toISOString();
    let transaction = null;
    let applied = false;

    const baseEvidence = (result, extra = {}) => ({
      scenarioId: scenario.id,
      scenarioVersion: scenario.version ?? "1",
      platform: scenario.platform,
      runtimeMode: scenario.runtimeMode,
      pathId: scenario.pathId ?? null,
      decisionId: scenario.decisionId ?? null,
      timestamp: this.clock().toISOString(),
      startedAt,
      result,
      securityState: securityHealthy ? "healthy" : "failed",
      verificationState: "unknown",
      evidenceSource: "network-acceptance-harness",
      ...extra,
    });

    if (!userAllowed) {
      const evidence = baseEvidence("rejected", { failureClass: "user-denied" });
      await this.evidenceStore.record(evidence);
      return evidence;
    }

    if (!securityHealthy) {
      const evidence = baseEvidence("rejected", { failureClass: "security-failed" });
      await this.evidenceStore.record(evidence);
      return evidence;
    }

    try {
      const capability = await this.capabilityGate(scenario.requiredCapabilities, scenario);
      if (!capability?.allowed) {
        const evidence = baseEvidence("rejected", {
          failureClass: "capability-unavailable",
          verificationState: "failed",
          capability,
        });
        await this.evidenceStore.record(evidence);
        return evidence;
      }

      transaction = await this.prepare(scenario);
      if (!transaction) throw Object.assign(new Error("prepare returned no transaction"), { failureClass: "unknown" });

      const appliedResult = await this.apply(transaction, scenario);
      applied = true;
      const live = await this.liveVerify(transaction, scenario);
      if (!live?.verified) {
        throw Object.assign(new Error("live verification failed"), {
          failureClass: classifyFailure(live?.failureClass ?? "verification-failed"),
          live,
        });
      }

      const traffic = await this.trafficAcceptance(transaction, scenario);
      const result = RESULTS.includes(traffic?.result) ? traffic.result : "failure";
      if (result === "failure") {
        throw Object.assign(new Error("traffic acceptance failed"), {
          failureClass: classifyFailure(traffic?.failureClass ?? "traffic-failed"),
          traffic,
        });
      }

      const evidence = baseEvidence(result, {
        verificationState: "verified",
        capability,
        apply: appliedResult,
        liveVerify: live,
        trafficAcceptance: traffic,
      });
      await this.evidenceStore.record(evidence);
      return evidence;
    } catch (error) {
      const failureClass = classifyFailure(error);
      let rollbackResult = null;
      let cleanup = null;
      if (applied || transaction) {
        try {
          rollbackResult = await this.rollback(transaction, scenario);
          cleanup = await this.cleanupVerify(transaction, scenario);
        } catch (rollbackError) {
          cleanup = { verified: false, failureClass: classifyFailure(rollbackError) };
        }
      }
      const cleanupVerified = cleanup?.verified === true;
      const evidence = baseEvidence("failure", {
        failureClass: cleanupVerified ? failureClass : "cleanup-failed",
        verificationState: "failed",
        error: error instanceof Error ? error.message : String(error),
        rollback: rollbackResult,
        cleanupVerify: cleanup,
      });
      await this.evidenceStore.record(evidence);
      return evidence;
    }
  }
}

export const NETWORK_ACCEPTANCE_RESULTS = RESULTS;
export const NETWORK_ACCEPTANCE_FAILURE_CLASSES = FAILURE_CLASSES;
