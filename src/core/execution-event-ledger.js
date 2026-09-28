const DEFAULT_MAX_EVENTS = 256;

function freezeEvent(event) {
  return Object.freeze({
    ...event,
    context: Object.freeze({ ...(event.context || {}) })
  });
}

/**
 * Bounded, in-memory execution security event ledger.
 *
 * The ledger is evidence-oriented: it records why a running execution session
 * was invalidated, without retaining kernel credentials, configs, or payloads.
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
      context
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
