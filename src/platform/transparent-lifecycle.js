export const TRANSPARENT_LIFECYCLE_VERSION = 1;

export const TransparentLifecycleStates = Object.freeze({
  INACTIVE: "inactive",
  ADMITTING: "admitting",
  DRAINING: "draining",
  DRAINED: "drained",
  ACTIVATING: "activating",
  ACTIVE: "active",
  ROLLING_BACK: "rolling-back",
  FAILED: "failed",
});

const TERMINAL = new Set([
  TransparentLifecycleStates.DRAINED,
  TransparentLifecycleStates.ACTIVE,
  TransparentLifecycleStates.FAILED,
]);

export function createTransparentLifecycle(initial = TransparentLifecycleStates.INACTIVE) {
  if (!Object.values(TransparentLifecycleStates).includes(initial)) throw new Error("unsupported lifecycle state");
  let state = initial;
  let generation = 0;
  let activeBackend = null;
  let pendingBackend = null;
  let admitted = true;
  let error = null;

  function snapshot() {
    return Object.freeze({
      version: TRANSPARENT_LIFECYCLE_VERSION,
      state,
      generation,
      activeBackend,
      pendingBackend,
      admitted,
      error,
    });
  }

  function transition(next, backend = null, message = null) {
    state = next;
    if (backend !== null) activeBackend = backend;
    error = message;
    generation += 1;
    return snapshot();
  }

  return Object.freeze({
    snapshot,
    beginAdmission(backend) {
      if (state === TransparentLifecycleStates.ACTIVE || state === TransparentLifecycleStates.INACTIVE || state === TransparentLifecycleStates.DRAINED) {
        pendingBackend = backend;
        admitted = true;
        return transition(TransparentLifecycleStates.ADMITTING, backend);
      }
      throw new Error("cannot begin admission from " + state);
    },
    activate() {
      if (state !== TransparentLifecycleStates.ADMITTING && state !== TransparentLifecycleStates.ACTIVATING) {
        throw new Error("cannot activate from " + state);
      }
      admitted = true;
      if (pendingBackend !== null) activeBackend = pendingBackend;
      pendingBackend = null;
      return transition(TransparentLifecycleStates.ACTIVE, activeBackend);
    },
    beginDrain() {
      if (state !== TransparentLifecycleStates.ACTIVE) throw new Error("cannot drain from " + state);
      admitted = false;
      return transition(TransparentLifecycleStates.DRAINING);
    },
    markDrained() {
      if (state !== TransparentLifecycleStates.DRAINING) throw new Error("cannot mark drained from " + state);
      admitted = false;
      return transition(TransparentLifecycleStates.DRAINED);
    },
    beginActivation(backend) {
      if (state !== TransparentLifecycleStates.DRAINED && state !== TransparentLifecycleStates.ADMITTING) {
        throw new Error("cannot begin activation from " + state);
      }
      pendingBackend = backend;
      admitted = false;
      return transition(TransparentLifecycleStates.ACTIVATING);
    },
    rollback(message = "activation-failed") {
      if (state !== TransparentLifecycleStates.ACTIVATING && state !== TransparentLifecycleStates.ADMITTING && state !== TransparentLifecycleStates.ACTIVE) {
        throw new Error("cannot rollback from " + state);
      }
      pendingBackend = null;
      admitted = false;
      return transition(TransparentLifecycleStates.ROLLING_BACK, activeBackend, message);
    },
    fail(message = "lifecycle-failed") {
      admitted = false;
      return transition(TransparentLifecycleStates.FAILED, activeBackend, message);
    },
    recover() {
      if (state !== TransparentLifecycleStates.ROLLING_BACK) throw new Error("cannot recover from " + state);
      pendingBackend = null;
      admitted = activeBackend !== null;
      return transition(activeBackend ? TransparentLifecycleStates.ACTIVE : TransparentLifecycleStates.INACTIVE);
    },
    isTerminal() {
      return TERMINAL.has(state);
    },
  });
}

export function canAdmitNewFlows(snapshot) {
  return Boolean(snapshot && snapshot.admitted === true && snapshot.state === TransparentLifecycleStates.ACTIVE);
}
