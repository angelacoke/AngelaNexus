import { createKernelExecution } from "./kernel-execution.js";
import { Kernels } from "./model.js";

export const ExecutionStates = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing",
  READY: "ready",
  RUNNING: "running",
  STOPPING: "stopping",
  FAILED: "failed"
});

function assertRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("execution request is required");
  if (!Object.values(Kernels).includes(request.kernel)) throw new Error("execution request has unsupported kernel");
  if (!request.config || typeof request.config !== "object") throw new TypeError("execution request config is required");
  if (request.config.kernel !== request.kernel) throw new Error("execution request kernel does not match config kernel");
  if (request.userAuthorized !== true) throw new Error("execution requires explicit user authorization");
  if (!request.security || request.security.preflightPassed !== true) {
    throw new Error("execution requires a passed security preflight");
  }
  if (request.security.failClosed !== true) {
    throw new Error("execution requires fail-closed security mode");
  }
  if (!request.path || request.path.validated !== true) {
    throw new Error("execution requires a validated network path");
  }
}

export function createExecutionRequest(request) {
  assertRequest(request);
  return Object.freeze({
    ...request,
    security: Object.freeze({ ...request.security }),
    path: Object.freeze({ ...request.path })
  });
}

export function createExecutionController(options = {}) {
  const executionFactory = options.executionFactory || createKernelExecution;
  if (typeof executionFactory !== "function") throw new TypeError("executionFactory must be a function");

  let state = ExecutionStates.IDLE;
  let execution = null;
  let request = null;
  let failure = null;

  function snapshot() {
    return Object.freeze({
      state,
      kernel: request ? request.kernel : null,
      configPath: execution ? execution.configPath : null,
      failure
    });
  }

  return Object.freeze({
    get state() { return state; },

    async prepare(input) {
      if (state !== ExecutionStates.IDLE && state !== ExecutionStates.FAILED) {
        throw new Error("execution controller is not idle");
      }
      state = ExecutionStates.PREPARING;
      failure = null;
      try {
        request = createExecutionRequest(input);
        execution = await executionFactory(request.config, {
          binary: request.binary,
          workdir: request.workdir,
          cwd: request.cwd,
          env: request.env,
          reloadSignal: request.reloadSignal,
          runtimeFactory: request.runtimeFactory
        });
        state = ExecutionStates.READY;
        return snapshot();
      } catch (error) {
        execution = null;
        failure = error.message;
        state = ExecutionStates.FAILED;
        throw error;
      }
    },

    async start() {
      if (!execution || state !== ExecutionStates.READY) throw new Error("execution is not ready");
      try {
        await execution.start();
        state = ExecutionStates.RUNNING;
        return snapshot();
      } catch (error) {
        failure = error.message;
        state = ExecutionStates.FAILED;
        throw error;
      }
    },

    async stop() {
      if (!execution) return snapshot();
      if (state !== ExecutionStates.RUNNING && state !== ExecutionStates.READY) {
        throw new Error("execution is not stoppable");
      }
      state = ExecutionStates.STOPPING;
      try {
        await execution.stop();
        execution = null;
        request = null;
        state = ExecutionStates.IDLE;
        return snapshot();
      } catch (error) {
        failure = error.message;
        state = ExecutionStates.FAILED;
        throw error;
      }
    },

    async reload() {
      if (!execution || state !== ExecutionStates.RUNNING) throw new Error("execution is not running");
      return execution.reload();
    },

    async status() {
      if (!execution) return Object.freeze({ controller: snapshot(), execution: null });
      return Object.freeze({ controller: snapshot(), execution: await execution.status() });
    },

    async logs(options = {}) {
      if (!execution) return [];
      return execution.logs(options);
    },

    snapshot
  });
}
