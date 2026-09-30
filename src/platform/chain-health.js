export const PROBE_TYPES = Object.freeze({ ICMP: "icmp", TCP: "tcp" });
export const HEALTH_STATES = Object.freeze({ UNKNOWN: "unknown", HEALTHY: "healthy", DEGRADED: "degraded", DOWN: "down" });

function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function now(value) { const n = finite(value); return n === null ? Date.now() : n; }

export function createHopProbeSpec({ hopId, host, port, type = PROBE_TYPES.TCP, timeoutMs = 3000 } = {}) {
  if (typeof hopId !== "string" || !hopId.trim()) throw new Error("hop probe requires hopId");
  if (typeof host !== "string" || !host.trim()) throw new Error("hop probe requires host");
  if (!Object.values(PROBE_TYPES).includes(type)) throw new Error("unsupported hop probe type: " + type);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError("hop probe port is invalid");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new RangeError("hop probe timeout is invalid");
  return Object.freeze({ hopId: hopId.trim(), host: host.trim(), port, type, timeoutMs });
}

export function evaluateHopHealth({ latencyMs, success, thresholdMs = 500, timestamp } = {}) {
  const latency = finite(latencyMs);
  const ok = success === true && latency !== null;
  const state = !ok ? HEALTH_STATES.DOWN : latency > thresholdMs ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY;
  return Object.freeze({
    state,
    latencyMs: latency,
    success: ok,
    thresholdMs,
    timestamp: now(timestamp),
  });
}

export function aggregateChainHealth(hops = []) {
  const list = Array.isArray(hops) ? hops : [];
  const states = list.map((x) => x && x.state);
  const state = states.includes(HEALTH_STATES.DOWN) ? HEALTH_STATES.DOWN :
    states.includes(HEALTH_STATES.DEGRADED) ? HEALTH_STATES.DEGRADED :
    states.length && states.every((x) => x === HEALTH_STATES.HEALTHY) ? HEALTH_STATES.HEALTHY :
    HEALTH_STATES.UNKNOWN;
  return Object.freeze({
    state,
    hops: Object.freeze(list.slice()),
    bottleneckHopId: list.filter((x) => x && Number.isFinite(x.latencyMs)).sort((a,b) => b.latencyMs - a.latencyMs)[0]?.hopId || null,
  });
}

export function createHopHealthProbe({ icmp, tcp }) {
  if (!icmp || typeof icmp.probe !== "function") throw new TypeError("icmp probe implementation is required");
  if (!tcp || typeof tcp.probe !== "function") throw new TypeError("tcp probe implementation is required");
  return Object.freeze({
    async probe(spec) {
      const started = Date.now();
      const result = spec.type === PROBE_TYPES.ICMP
        ? await icmp.probe(spec.host, spec.timeoutMs)
        : await tcp.probe(spec.host, spec.port, spec.timeoutMs);
      const latencyMs = finite(result && result.latencyMs);
      return evaluateHopHealth({
        latencyMs,
        success: Boolean(result && result.success),
        thresholdMs: result && result.thresholdMs,
        timestamp: Date.now(),
      });
    },
    measureElapsed(start = started) { return Date.now() - start; },
  });
}
