import { HEALTH_STATES, PROBE_TYPES, createHopProbeSpec } from "./chain-health.js";

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function finiteLatency(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeThresholds(options = {}) {
  return Object.freeze({
    degradedMs: positiveInteger(options.degradedMs, 500),
    downFailures: positiveInteger(options.downFailures, 2),
    recoveries: positiveInteger(options.recoveries, 2),
  });
}

function buildResult(spec, result, previous, thresholds, timestamp) {
  const latencyMs = finiteLatency(result && result.latencyMs);
  const success = Boolean(result && result.success === true && latencyMs !== null);
  const failures = success ? 0 : previous.failures + 1;
  const recoveries = success ? previous.recoveries + 1 : 0;
  let state = previous.state;

  if (success) {
    state = latencyMs > thresholds.degradedMs ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY;
    if (previous.state === HEALTH_STATES.DOWN && recoveries < thresholds.recoveries) state = HEALTH_STATES.DOWN;
  } else if (failures >= thresholds.downFailures) {
    state = HEALTH_STATES.DOWN;
  } else if (previous.state === HEALTH_STATES.UNKNOWN) {
    state = HEALTH_STATES.UNKNOWN;
  } else {
    state = previous.state === HEALTH_STATES.DOWN ? HEALTH_STATES.DOWN : HEALTH_STATES.DEGRADED;
  }

  return Object.freeze({
    hopId: spec.hopId,
    host: spec.host,
    port: spec.port,
    type: spec.type,
    state,
    latencyMs,
    success,
    failures,
    recoveries,
    thresholdMs: thresholds.degradedMs,
    timestamp,
    error: result && result.error ? String(result.error) : null,
  });
}

export function createChainHealthMonitor({
  probe,
  intervalMs = 5000,
  thresholds = {},
  clock = () => Date.now(),
  setTimer = (fn, delay) => setTimeout(fn, delay),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  if (!probe || typeof probe.probe !== "function") throw new TypeError("health monitor probe is required");
  const interval = positiveInteger(intervalMs, 5000);
  const normalizedThresholds = normalizeThresholds(thresholds);
  const states = new Map();
  const specs = new Map();
  let timer = null;
  let running = false;
  let generation = 0;
  let listeners = new Set();

  function emit(snapshot) {
    for (const listener of listeners) {
      try { listener(snapshot); } catch {}
    }
  }

  function stateFor(hopId) {
    return states.get(hopId) || Object.freeze({
      hopId,
      state: HEALTH_STATES.UNKNOWN,
      latencyMs: null,
      success: false,
      failures: 0,
      recoveries: 0,
      timestamp: clock(),
    });
  }

  async function pollOne(spec) {
    const currentGeneration = generation;
    const previous = stateFor(spec.hopId);
    try {
      const result = await probe.probe(spec);
      if (currentGeneration !== generation) return null;
      const next = buildResult(spec, result, previous, normalizedThresholds, clock());
      states.set(spec.hopId, next);
      return next;
    } catch (error) {
      if (currentGeneration !== generation) return null;
      const next = buildResult(spec, { success: false, error: error && error.message ? error.message : error }, previous, normalizedThresholds, clock());
      states.set(spec.hopId, next);
      return next;
    }
  }

  async function poll() {
    const batch = [...specs.values()];
    const results = await Promise.all(batch.map(pollOne));
    const valid = results.filter(Boolean);
    const snapshot = Object.freeze(valid);
    emit(snapshot);
    return snapshot;
  }

  function schedule() {
    if (!running || timer !== null) return;
    timer = setTimer(async () => {
      timer = null;
      if (!running) return;
      await poll();
      schedule();
    }, interval);
  }

  return Object.freeze({
    addHop({ hopId, host, port, type = PROBE_TYPES.TCP, timeoutMs = 3000 } = {}) {
      const spec = createHopProbeSpec({ hopId, host, port, type, timeoutMs });
      specs.set(spec.hopId, spec);
      if (!states.has(spec.hopId)) states.set(spec.hopId, stateFor(spec.hopId));
      return spec;
    },
    removeHop(hopId) {
      specs.delete(hopId);
      states.delete(hopId);
    },
    async poll() { return poll(); },
    async start({ immediate = true } = {}) {
      if (running) return Object.freeze([...states.values()]);
      generation += 1;
      running = true;
      if (immediate) await poll();
      schedule();
      return Object.freeze([...states.values()]);
    },
    async stop() {
      generation += 1;
      running = false;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("health monitor listener is required");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() { return Object.freeze([...states.values()]); },
    getState(hopId) { return stateFor(hopId); },
    isRunning() { return running; },
  });
}
