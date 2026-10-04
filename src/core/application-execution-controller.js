import { createApplicationExecutionEvidence, recordApplicationExecutionEvidence } from "./application-execution-evidence.js";
import { createDriverSelection } from "./driver-scheduler.js";
import { createExecutionEventLedger } from "./execution-event-ledger.js";

export const ApplicationExecutionStates = Object.freeze({
  IDLE: "idle",
  PLANNED: "planned",
  EXECUTING: "executing",
  ACTIVE: "active",
  VERIFIED: "verified",
  UNVERIFIED: "unverified",
  FAILED: "failed",
  STOPPED: "stopped"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeId(value) {
  const v = text(value);
  return v ? v.slice(0, 256) : null;
}

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freeze(v)])));
}

function assertInput(input) {
  if (!input || typeof input !== "object") throw new TypeError("application execution input is required");
  if (!input.identity || typeof input.identity !== "object") throw new TypeError("application execution requires application identity");
  if (!input.policy || typeof input.policy !== "object") throw new TypeError("application execution requires routing policy result");
  if (!Array.isArray(input.drivers)) throw new TypeError("application execution requires driver registry");
  if (input.userAuthorized !== true) throw new Error("application execution requires explicit user authorization");
}

function verificationFrom(result) {
  const verification = result?.verification;
  if (!verification || typeof verification !== "object") {
    return Object.freeze({ status: "unverified", reason: "no egress verifier result was returned" });
  }
  const status = verification.status === "verified" ? "verified" : "unverified";
  return Object.freeze({
    status,
    reason: safeId(verification.reason) || (status === "verified" ? "egress verifier explicitly confirmed execution" : "egress verification did not confirm execution"),
  });
}

export function createApplicationExecutionController(options = {}) {
  const eventLedger = options.eventLedger || createExecutionEventLedger();
  if (!eventLedger || typeof eventLedger.record !== "function" || typeof eventLedger.snapshot !== "function") {
    throw new TypeError("eventLedger must expose record and snapshot");
  }
  const verifier = options.verifier;
  if (verifier !== undefined && typeof verifier !== "function") throw new TypeError("verifier must be a function");

  let state = ApplicationExecutionStates.IDLE;
  let plan = null;
  let driver = null;
  let execution = null;
  let evidence = null;
  let failure = null;

  function snapshot() {
    return Object.freeze({
      state,
      decisionId: plan?.decisionId || null,
      driver: driver?.id || null,
      executionStatus: evidence?.executionStatus || null,
      verificationStatus: evidence?.verificationStatus || null,
      verified: evidence?.verified === true,
      failure
    });
  }

  function record(input) {
    evidence = createApplicationExecutionEvidence(input);
    try { recordApplicationExecutionEvidence(eventLedger, input); } catch {}
    return evidence;
  }

  async function emit(type, context) {
    try { eventLedger.record(type, context); } catch {}
    if (typeof options.eventSink === "function") {
      try { await options.eventSink(type, context); } catch {}
    }
  }

  return Object.freeze({
    get state() { return state; },
    events() { return eventLedger.snapshot(); },
    evidence() { return evidence; },
    snapshot,

    async planExecution(input) {
      if (state !== ApplicationExecutionStates.IDLE && state !== ApplicationExecutionStates.STOPPED && state !== ApplicationExecutionStates.FAILED) {
        throw new Error("application execution controller is not idle");
      }
      assertInput(input);
      failure = null;
      const selection = createDriverSelection({
        plan: input.plan || { kind: "application-execution-plan", application: { identity: input.identity, selector: input.selector || {} } },
        drivers: input.drivers,
        requiredCapabilities: input.requiredCapabilities,
        allowedDrivers: input.allowedDrivers,
        fixedDriver: input.fixedDriver,
        preferredDrivers: input.preferredDrivers,
        allowFailover: input.allowFailover
      });
      if (!selection.selected) {
        state = ApplicationExecutionStates.FAILED;
        failure = selection.explanation;
        await emit("application-execution-failed", {
          reason: "driver-selection-failed",
          decisionId: safeId(input.decisionId || input.policy.decisionId),
          state
        });
        throw new Error(selection.explanation);
      }

      driver = input.drivers.find(item => item?.id === selection.selected.id) || null;
      plan = freeze({
        ...input,
        driverId: driver.id,
        decisionId: safeId(input.decisionId || input.policy.decisionId)
      });
      state = ApplicationExecutionStates.PLANNED;
      record({
        identity: input.identity,
        policy: input.policy,
        driver,
        kernel: input.kernel || input.backend,
        decisionId: plan.decisionId,
        scope: input.scope || "application",
        executionStatus: "planned",
        verification: { status: "unverified", reason: "execution has not started" }
      });
      await emit("application-execution-planned", {
        decisionId: plan.decisionId,
        driver: driver.id,
        state,
        verification: "unverified"
      });
      return Object.freeze({ ...snapshot(), selection, plan });
    },

    async execute() {
      if (state !== ApplicationExecutionStates.PLANNED || !driver || !plan) {
        throw new Error("application execution is not planned");
      }
      if (typeof driver.execute !== "function") {
        state = ApplicationExecutionStates.FAILED;
        failure = "selected driver has no execute function";
        throw new Error(failure);
      }

      state = ApplicationExecutionStates.EXECUTING;
      try {
        const result = await driver.execute(plan);
        execution = result?.execution || result || null;
        const executionStatus = text(result?.status) || "active";
        record({
          identity: plan.identity,
          policy: plan.policy,
          driver,
          kernel: plan.kernel || plan.backend,
          decisionId: plan.decisionId,
          scope: plan.scope || "application",
          executionStatus,
          verification: { status: "unverified", reason: "execution completed but egress has not been verified" }
        });
        state = executionStatus === "active" || executionStatus === "running"
          ? ApplicationExecutionStates.ACTIVE
          : ApplicationExecutionStates.EXECUTING;
        await emit("application-execution-active", {
          decisionId: plan.decisionId,
          driver: driver.id,
          state,
          executionStatus
        });

        let verification = result?.verification;
        if (verifier) {
          verification = await verifier({
            plan,
            driver,
            execution,
            executionResult: result
          });
        }
        const normalized = verificationFrom({ verification });
        record({
          identity: plan.identity,
          policy: plan.policy,
          driver,
          kernel: plan.kernel || plan.backend,
          decisionId: plan.decisionId,
          scope: plan.scope || "application",
          executionStatus,
          verification: normalized
        });
        state = normalized.status === "verified"
          ? ApplicationExecutionStates.VERIFIED
          : ApplicationExecutionStates.UNVERIFIED;
        await emit("application-execution-verified", {
          decisionId: plan.decisionId,
          driver: driver.id,
          state,
          verificationStatus: normalized.status,
          verificationReason: normalized.reason
        });
        return snapshot();
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        state = ApplicationExecutionStates.FAILED;
        record({
          identity: plan.identity,
          policy: plan.policy,
          driver,
          kernel: plan.kernel || plan.backend,
          decisionId: plan.decisionId,
          scope: plan.scope || "application",
          executionStatus: "failed",
          verification: { status: "unverified", reason: "execution failed" }
        });
        await emit("application-execution-failed", {
          decisionId: plan.decisionId,
          driver: driver.id,
          state,
          reason: failure
        });
        throw error;
      }
    },

    async stop() {
      if (!execution) {
        state = state === ApplicationExecutionStates.FAILED ? state : ApplicationExecutionStates.STOPPED;
        return snapshot();
      }
      try {
        if (typeof execution.stop === "function") await execution.stop();
      } finally {
        execution = null;
        state = ApplicationExecutionStates.STOPPED;
        await emit("application-execution-stopped", {
          decisionId: plan?.decisionId || null,
          driver: driver?.id || null,
          state
        });
      }
      return snapshot();
    }
  });
}
