const DEFAULT_MAX_EVENTS = 256;
const MAX_STRING_LENGTH = 256;
const MAX_EVIDENCE_ITEMS = 32;
const MAX_SCORE = 1000000;

const SAFE_CONTEXT_KEYS = new Set([
  "reason",
  "kernel",
  "decisionId",
  "decisionVersion",
  "state",
  "evidence"
]);

const SAFE_EVIDENCE_KEYS = new Set([
  "state",
  "signals",
  "actions",
  "score",
  "confidence"
]);

function cloneSafeValue(value, depth = 0) {
  if (depth > 3) return undefined;
  if (typeof value === "string") {
    return value.length <= MAX_STRING_LENGTH ? value : value.slice(0, MAX_STRING_LENGTH);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_EVIDENCE_ITEMS)
      .map(item => cloneSafeValue(item, depth + 1))
      .filter(item => item !== undefined);
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_EVIDENCE_ITEMS)) {
      if (key.length > MAX_STRING_LENGTH) continue;
      const cloned = cloneSafeValue(item, depth + 1);
      if (cloned !== undefined) output[key] = cloned;
    }
    return output;
  }
  return undefined;
}

function sanitizeBoundedString(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().slice(0, MAX_STRING_LENGTH);
}

function sanitizeEvidenceList(value) {
  if (!Array.isArray(value)) return undefined;
  const output = [];
  for (const item of value.slice(0, MAX_EVIDENCE_ITEMS)) {
    const normalized = sanitizeBoundedString(item);
    if (normalized !== undefined) output.push(normalized);
  }
  return output;
}

function sanitizeContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("event context must be an object");
  }

  const output = {};
  for (const key of SAFE_CONTEXT_KEYS) {
    if (!(key in context)) continue;
    if (key === "evidence") {
      if (!context.evidence || typeof context.evidence !== "object" || Array.isArray(context.evidence)) continue;
      const evidence = {};
      for (const evidenceKey of SAFE_EVIDENCE_KEYS) {
        if (!(evidenceKey in context.evidence)) continue;
        if (evidenceKey === "state") {
          const state = sanitizeBoundedString(context.evidence.state);
          if (state !== undefined) evidence.state = state;
          continue;
        }
        if (evidenceKey === "signals" || evidenceKey === "actions") {
          const list = sanitizeEvidenceList(context.evidence[evidenceKey]);
          if (list !== undefined) evidence[evidenceKey] = list;
          continue;
        }
        if (evidenceKey === "score") {
          const score = context.evidence.score;
          if (typeof score === "number" && Number.isFinite(score) && Math.abs(score) <= MAX_SCORE) evidence.score = score;
          continue;
        }
        if (evidenceKey === "confidence") {
          const confidence = context.evidence.confidence;
          if (typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) evidence.confidence = confidence;
        }
      }
      output.evidence = evidence;
      continue;
    }
    if (key === "reason" || key === "kernel" || key === "decisionId" || key === "state") {
      const normalized = sanitizeBoundedString(context[key]);
      if (normalized !== undefined) output[key] = normalized;
      continue;
    }
    if (key === "decisionVersion") {
      if (Number.isInteger(context[key]) && context[key] >= 0) output[key] = context[key];
      continue;
    }
    const cloned = cloneSafeValue(context[key]);
    if (cloned !== undefined) output[key] = cloned;
  }
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function freezeEvent(event) {
  return deepFreeze(event);
}

/**
 * Bounded, in-memory execution security event ledger.
 *
 * The ledger is evidence-oriented and privacy-minimized: only the explicit
 * execution evidence schema is retained. Unknown fields, kernel credentials,
 * configs, payloads, and unsupported nested values are discarded.
 */
export function createExecutionEventLedger(options = {}) {
  const maxEvents = Number.isInteger(options.maxEvents) && options.maxEvents > 0
    ? options.maxEvents
    : DEFAULT_MAX_EVENTS;
  const events = [];
  let nextEventId = 1;

  function record(type, context = {}) {
    if (typeof type !== "string" || !type.trim()) throw new TypeError("event type must be a non-empty string");
    const event = freezeEvent({
      id: String(nextEventId++),
      type: type.trim(),
      at: (() => {
        const value = typeof options.clock === "function" ? options.clock() : Date.now();
        return Number.isFinite(value) ? value : Date.now();
      })(),
      context: sanitizeContext(context)
    });
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    return event;
  }

  function snapshot() {
    return Object.freeze(events.slice());
  }

  function clear() {
    events.length = 0;
  }

  return Object.freeze({ record, snapshot, clear });
}
