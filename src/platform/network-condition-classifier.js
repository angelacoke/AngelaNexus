export const NETWORK_CONDITION_VERSION = 1;

export const NetworkConditions = Object.freeze({
  UNKNOWN: "unknown",
  HEALTHY: "healthy",
  RANDOM_LOSS: "random-loss",
  QUEUE_CONGESTION: "queue-congestion",
  HIGH_LATENCY: "high-latency",
  DEGRADED: "degraded",
});

const LIMITS = Object.freeze({
  maxRttMs: 60000,
  maxQueueingDelayMs: 60000,
  maxRetransmissionRatio: 1,
  maxEcnRatio: 1,
});

function bounded(value, max) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null;
}

function ratio(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 1) : null;
}

export function classifyNetworkCondition({
  rttMs = null,
  baseRttMs = null,
  queueingDelayMs = null,
  retransmissionRatio = null,
  ecnRatio = null,
  deliveryRateBps = null,
  samples = 0,
} = {}) {
  const rtt = bounded(rttMs, LIMITS.maxRttMs);
  const base = bounded(baseRttMs, LIMITS.maxRttMs);
  const queue = bounded(queueingDelayMs, LIMITS.maxQueueingDelayMs);
  const retrans = ratio(retransmissionRatio);
  const ecn = ratio(ecnRatio);
  const sampleCount = Number.isInteger(samples) && samples >= 0 ? samples : 0;

  if (sampleCount < 1 || (rtt === null && retrans === null && queue === null && ecn === null)) {
    return Object.freeze({ version: NETWORK_CONDITION_VERSION, condition: NetworkConditions.UNKNOWN, confidence: "insufficient-data", evidence: Object.freeze({ sampleCount }) });
  }

  const latencyRatio = rtt !== null && base !== null && base > 0 ? Math.max(0, (rtt - base) / base) : null;
  const queueCongested = (queue !== null && queue >= 50) || (latencyRatio !== null && latencyRatio >= 0.5) || (ecn !== null && ecn >= 0.05);
  const lossObserved = retrans !== null && retrans > 0;
  const randomLoss = lossObserved && !queueCongested;
  const highLatency = rtt !== null && rtt >= 300 && !queueCongested;
  const condition = queueCongested
    ? NetworkConditions.QUEUE_CONGESTION
    : randomLoss
      ? NetworkConditions.RANDOM_LOSS
      : highLatency
        ? NetworkConditions.HIGH_LATENCY
        : NetworkConditions.HEALTHY;

  const availableSignals = [rtt, base, queue, retrans, ecn, deliveryRateBps].filter((v) => v !== null).length;
  const confidence = sampleCount >= 10 && availableSignals >= 2 ? "high" : sampleCount >= 3 ? "medium" : "low";

  return Object.freeze({
    version: NETWORK_CONDITION_VERSION,
    condition,
    confidence,
    evidence: Object.freeze({
      sampleCount,
      rttMs: rtt,
      baseRttMs: base,
      queueingDelayMs: queue,
      retransmissionRatio: retrans,
      ecnRatio: ecn,
      deliveryRateBps: Number.isFinite(deliveryRateBps) && deliveryRateBps >= 0 ? deliveryRateBps : null,
      latencyInflationRatio: latencyRatio,
      queueCongested,
      lossObserved,
    }),
  });
}

export function isSafeForLossCompensation(classification) {
  return Boolean(
    classification &&
    classification.condition === NetworkConditions.RANDOM_LOSS &&
    classification.confidence === "high"
  );
}
