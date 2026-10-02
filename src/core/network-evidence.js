export const NETWORK_EVIDENCE_VERSION = 1;

export const NetworkEvidenceKinds = Object.freeze({
  FLOW: "flow",
  PATH: "path",
  DNS: "dns",
  DRIVER: "driver",
  PLATFORM: "platform",
});

const DEFAULT_MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const KINDS = new Set(Object.values(NetworkEvidenceKinds));

function normalizeId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeMetrics(metrics = {}) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return {};
  const allowed = [
    "rttMs",
    "baseRttMs",
    "queueingDelayMs",
    "retransmissionRatio",
    "deliveryRate",
    "lossRatio",
    "dnsLatencyMs",
    "connectionSetupMs",
    "sampleCount",
  ];
  return Object.fromEntries(
    allowed
      .map((key) => [key, finiteNumber(metrics[key])])
      .filter(([, value]) => value !== null),
  );
}

function normalizeEvidence(input, now) {
  if (!input || typeof input !== "object") return null;
  const id = normalizeId(input.id);
  const kind = normalizeId(input.kind);
  if (!id || !KINDS.has(kind)) return null;

  const observedAt = finiteNumber(input.observedAt) ?? now;
  if (observedAt < 0) return null;

  return Object.freeze({
    version: NETWORK_EVIDENCE_VERSION,
    id,
    kind,
    observedAt,
    source: normalizeId(input.source) || "unknown",
    confidence: typeof input.confidence === "number"
      ? Math.min(1, Math.max(0, input.confidence))
      : null,
    metrics: Object.freeze(sanitizeMetrics(input.metrics)),
    attributes: Object.freeze(
      input.attributes && typeof input.attributes === "object" && !Array.isArray(input.attributes)
        ? { ...input.attributes }
        : {},
    ),
  });
}

export function createNetworkEvidenceStore({
  maxEntries = DEFAULT_MAX_ENTRIES,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("maxEntries must be a positive integer");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error("ttlMs must be a non-negative number");
  }
  if (typeof now !== "function") throw new Error("now must be a function");

  const entries = new Map();

  function prune(timestamp = now()) {
    for (const [key, entry] of entries) {
      if (timestamp - entry.observedAt > ttlMs) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  function record(input) {
    const evidence = normalizeEvidence(input, now());
    if (!evidence) return Object.freeze({ ok: false, reason: "invalid-evidence" });

    prune(evidence.observedAt);
    const key = evidence.kind + ":" + evidence.id;
    entries.delete(key);
    entries.set(key, evidence);
    prune(evidence.observedAt);

    return Object.freeze({ ok: true, evidence });
  }

  function get(id, kind) {
    const key = normalizeId(kind) + ":" + normalizeId(id);
    const entry = entries.get(key);
    if (!entry) return null;
    prune(now());
    return entries.get(key) || null;
  }

  function list(kind) {
    prune(now());
    if (kind === undefined) return Object.freeze([...entries.values()]);
    if (!KINDS.has(kind)) return Object.freeze([]);
    return Object.freeze([...entries.values()].filter((entry) => entry.kind === kind));
  }

  function clear() {
    entries.clear();
  }

  return Object.freeze({
    version: NETWORK_EVIDENCE_VERSION,
    record,
    get,
    list,
    clear,
    snapshot() {
      prune(now());
      return Object.freeze({
        version: NETWORK_EVIDENCE_VERSION,
        size: entries.size,
        maxEntries,
        ttlMs,
        entries: Object.freeze([...entries.values()]),
      });
    },
  });
}
