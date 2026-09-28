const DEFAULT_MAX_EVENTS = 256;

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
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => cloneSafeValue(item, depth + 1)).filter(item => item !== undefined);
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const cloned = cloneSafeValue(item, depth + 1);
      if (cloned !== undefined) output[key] = cloned;
    }
    return output;
  }
  return undefined;
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
        const cloned = cloneSafeValue(context.evidence[evidenceKey]);
        if (cloned !== undefined) evidence[evidenceKey] = cloned;
      }
      output.evidence = evidence;
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

  function record(type, context = {}) {
    if (typeof type !== "string" || !type.trim()) throw new TypeError("event type must be a non-empty string");
    const event = freezeEvent({
      id: String(events.length + 1),
      type: type.trim(),
      at: typeof options.clock === "function" ? options.clock() : Date.now(),
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
