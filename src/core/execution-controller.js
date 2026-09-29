import { createKernelExecution } from "./kernel-execution.js";
import { Kernels } from "./model.js";
import { createExecutionContract } from "./execution-contract.js";
import { createPlannedExecutionContract } from "./decision-planner.js";
import { createExecutionEventLedger } from "./execution-event-ledger.js";
import { evaluatePathTrust } from "./path-trust.js";

export const ExecutionStates = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing",
  READY: "ready",
  STARTING: "starting",
  RUNNING: "running",
  STOPPING: "stopping",
  FAILED: "failed"
});

function assertRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("execution request is required");
  if (!request.decision) throw new Error("execution request requires a system decision");
  if (!Object.values(Kernels).includes(request.kernel)) throw new Error("execution request has unsupported kernel");
  if (!request.config || typeof request.config !== "object") throw new TypeError("execution request config is required");
  if (request.config.kernel !== request.kernel) throw new Error("execution request kernel does not match config kernel");
  if (request.userAuthorized !== true) throw new Error("execution requires explicit user authorization");
  if (!request.security || request.security.preflightPassed !== true) throw new Error("execution requires a passed security preflight");
  if (request.security.failClosed !== true) throw new Error("execution requires fail-closed security mode");
  if (!request.path || request.path.validated !== true) throw new Error("execution requires a validated network path");
}

export function createExecutionRequest(request) {
  assertRequest(request);
  return createExecutionContract(request);
}

export function createExecutionController(options = {}) {
  const executionFactory = options.executionFactory || createKernelExecution;
  const pathRevalidator = options.pathRevalidator;
  const sessionInvalidationSource = options.sessionInvalidationSource;
  const eventSink = options.eventSink;
  const eventLedger = options.eventLedger || createExecutionEventLedger();
  if (typeof executionFactory !== "function") throw new TypeError("executionFactory must be a function");
  if (typeof pathRevalidator !== "function") throw new TypeError("pathRevalidator must be a function");
  if (sessionInvalidationSource !== undefined && typeof sessionInvalidationSource !== "function") throw new TypeError("sessionInvalidationSource must be a function");
  if (eventSink !== undefined && typeof eventSink !== "function") throw new TypeError("eventSink must be a function");
  if (!eventLedger || typeof eventLedger.record !== "function" || typeof eventLedger.snapshot !== "function") throw new TypeError("eventLedger must expose record and snapshot");
  let state = ExecutionStates.IDLE;
  let execution = null;
  let request = null;
  let failure = null;
  let unsubscribeInvalidation = null;
  let invalidationInFlight = null;
  let sessionEpoch = 0;
  let sessionId = 0;

  function snapshot() {
    return Object.freeze({
      state,
      kernel: request ? request.kernel : null,
      decisionId: request ? request.decision.id : null,
      decisionVersion: request ? request.decision.version : null,
      configPath: execution ? execution.configPath : null,
      failure
    });
  }

  async function clearInvalidationSubscription() {
    sessionId += 1;
    if (unsubscribeInvalidation) { await unsubscribeInvalidation(); unsubscribeInvalidation = null; }
  }

  async function emitEvent(type, context = {}) {
    try { eventLedger.record(type, context); } catch {}
    if (!eventSink) return;
    try { await eventSink(type, context); } catch {}
  }

  async function invalidateRunningExecution(reason = "network-session-invalidated") {
    if (state !== ExecutionStates.RUNNING && state !== ExecutionStates.STARTING || !execution) return;
    const invalidationContext = reason && typeof reason === "object" ? reason : null;
    const normalizedReason = typeof reason === "string"
      ? reason
      : (invalidationContext && typeof invalidationContext.reason === "string"
        ? invalidationContext.reason
        : "network-session-invalidated");
    if (invalidationInFlight) return invalidationInFlight;
    invalidationInFlight = (async () => {
      sessionEpoch += 1;
      state = ExecutionStates.STOPPING;
      failure = normalizedReason;
      await emitEvent("session-invalidated", {
        reason: normalizedReason,
        kernel: request ? request.kernel : null,
        decisionId: request ? request.decision.id : null,
        decisionVersion: request ? request.decision.version : null,
        state: ExecutionStates.STOPPING,
        ...(invalidationContext ? {
          evidence: {
            state: invalidationContext.state,
            signals: Array.isArray(invalidationContext.signals) ? [...invalidationContext.signals] : undefined,
            actions: Array.isArray(invalidationContext.actions) ? [...invalidationContext.actions] : undefined,
            score: invalidationContext.score,
            confidence: invalidationContext.confidence
          }
        } : {})
      });
      try {
        await execution.stop();
      } finally {
        execution = null;
        request = null;
        await clearInvalidationSubscription();
        state = ExecutionStates.FAILED;
      }
    })();
    try { await invalidationInFlight; } finally { invalidationInFlight = null; }
  }

  async function discardExecution() {
    try {
      if (execution) await execution.stop();
    } finally {
      execution = null;
      request = null;
      await clearInvalidationSubscription();
    }
  }

  return Object.freeze({
    get state() { return state; },
    events() { return eventLedger.snapshot(); },

    async prepare(input) {
      if (state !== ExecutionStates.IDLE && state !== ExecutionStates.FAILED) throw new Error("execution controller is not idle");
      state = ExecutionStates.PREPARING;
      failure = null;
      try {
        if (execution) await discardExecution();
        const preparedSessionId = ++sessionId;
        request = createExecutionRequest(input);
        execution = await executionFactory(request.config, {
          binary: request.binary, workdir: request.workdir, cwd: request.cwd, env: request.env,
          reloadSignal: request.reloadSignal, runtimeFactory: request.runtimeFactory
        });
        if (sessionInvalidationSource) {
          unsubscribeInvalidation = await sessionInvalidationSource((reason) => {
            if (sessionId !== preparedSessionId) return undefined;
            return invalidateRunningExecution(reason);
          });
        }
        state = ExecutionStates.READY;
        return snapshot();
      } catch (error) {
        execution = null; request = null;
        await clearInvalidationSubscription();
        failure = error instanceof Error ? error.message : String(error);
        state = ExecutionStates.FAILED;
        await emitEvent("execution-failed", { reason: "prepare-failed", kernel: input && input.kernel, state });
        throw error;
      }
    },

    async preparePlanned(input) {
      const contract = createPlannedExecutionContract(input);
      return this.prepare(contract);
    },

    async start() {
      if (!execution || state !== ExecutionStates.READY) throw new Error("execution is not ready");
      const startingExecution = execution;
      state = ExecutionStates.STARTING;
      try {
        const currentPath = await pathRevalidator(request.path, request);
        if (!currentPath || currentPath.validated !== true) throw new Error("execution path revalidation failed");
        if (request.path.networkGeneration !== undefined && currentPath.networkGeneration !== request.path.networkGeneration) {
          throw new Error("execution path changed after decision validation");
        }
        if (request.path.trust && typeof request.path.trust === "object") {
          const trustInput = request.path.trust;
          const trustResult = evaluatePathTrust({
            expected: trustInput.expected || request.path,
            observed: trustInput.observed || currentPath,
            previous: trustInput.previous || null,
            policy: trustInput.policy || {}
          });
          if (!trustResult.trusted) {
            await emitEvent("path-trust-rejected", {
              reason: "path-trust-validation-failed",
              state: trustResult.state,
              signals: [...trustResult.signals],
              reasons: [...trustResult.reasons],
              kernel: request.kernel,
              decisionId: request.decision.id,
              decisionVersion: request.decision.version
            });
            throw new Error("execution path trust validation failed: " + trustResult.reasons.join(", "));
          }
        }
        if (state !== ExecutionStates.STARTING || execution !== startingExecution) {
          throw new Error("execution session invalidated during start");
        }
        await execution.start();
        if (state !== ExecutionStates.STARTING || execution !== startingExecution) {
          throw new Error("execution session invalidated during start");
        }
        state = ExecutionStates.RUNNING;
        return snapshot();
      }
      catch (error) {
        const failedKernel = request ? request.kernel : null;
        if (state === ExecutionStates.FAILED && !execution && failure) {
          throw new Error(failure);
        }
        failure = error instanceof Error ? error.message : String(error);
        try { if (execution) await execution.stop(); }
        catch (cleanupError) { failure += "; cleanup: " + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)); }
        finally { execution = null; request = null; await clearInvalidationSubscription(); }
        state = ExecutionStates.FAILED;
        await emitEvent("execution-failed", { reason: "start-failed", kernel: failedKernel, state });
        throw error;
      }
    },

    async stop() {
      if (!execution) {
        if (state === ExecutionStates.FAILED) { state = ExecutionStates.IDLE; request = null; failure = null; }
        return snapshot();
      }
      if (state !== ExecutionStates.RUNNING && state !== ExecutionStates.STARTING && state !== ExecutionStates.READY && state !== ExecutionStates.FAILED) throw new Error("execution is not stoppable");
      state = ExecutionStates.STOPPING;
      try { await execution.stop(); execution = null; request = null; await clearInvalidationSubscription(); state = ExecutionStates.IDLE; failure = null; return snapshot(); }
      catch (error) { failure = error instanceof Error ? error.message : String(error); state = ExecutionStates.FAILED; await emitEvent("execution-failed", { reason: "stop-failed", kernel: request ? request.kernel : null, state }); throw error; }
    },

    async reload() {
      if (!execution || state !== ExecutionStates.RUNNING) throw new Error("execution is not running");
      const reloadExecution = execution;
      const reloadEpoch = sessionEpoch;
      try {
        const result = await execution.reload();
        const currentPath = await pathRevalidator(request.path, request);
        if (!currentPath || currentPath.validated !== true) throw new Error("execution path revalidation failed after reload");
        if (request.path.networkGeneration !== undefined && currentPath.networkGeneration !== request.path.networkGeneration) {
          throw new Error("execution path changed after reload");
        }
        if (request.path.trust && typeof request.path.trust === "object") {
          const trustInput = request.path.trust;
          const trustResult = evaluatePathTrust({
            expected: trustInput.expected || request.path,
            observed: trustInput.observed || currentPath,
            previous: trustInput.previous || null,
            policy: trustInput.policy || {}
          });
          if (!trustResult.trusted) throw new Error("execution path trust validation failed after reload: " + trustResult.reasons.join(", "));
        }
        if (sessionEpoch !== reloadEpoch || state !== ExecutionStates.RUNNING || execution !== reloadExecution) {
          throw new Error("execution session invalidated during reload");
        }
        return result;
      }
      catch (error) {
        if (invalidationInFlight) {
          await invalidationInFlight;
          throw error;
        }
        const failedKernel = request ? request.kernel : null;
        failure = error instanceof Error ? error.message : String(error);
        state = ExecutionStates.STOPPING;
        try { await execution.stop(); }
        catch (cleanupError) {
          failure += "; cleanup: " + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
        }
        finally {
          execution = null;
          request = null;
          await clearInvalidationSubscription();
          state = ExecutionStates.FAILED;
        }
        await emitEvent("execution-failed", { reason: "reload-failed", kernel: failedKernel, state });
        throw error;
      }
    },

    async status() {
      if (!execution) return Object.freeze({ controller: snapshot(), execution: null });
      return Object.freeze({ controller: snapshot(), execution: await execution.status() });
    },

    async logs(options = {}) { if (!execution) return []; return execution.logs(options); },
    snapshot
  });
}
