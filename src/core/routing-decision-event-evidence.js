const MAX_SIGNAL_ITEMS = 32;
const MAX_SIGNAL_LENGTH = 128;

function text(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_SIGNAL_LENGTH) : "";
}

function boundedSignals(values) {
  return Object.freeze(
    values
      .filter(Boolean)
      .slice(0, MAX_SIGNAL_ITEMS)
      .map((value) => text(value))
      .filter(Boolean)
  );
}

export function createRoutingDecisionEventContext(decision) {
  if (!decision || typeof decision !== "object") {
    throw new TypeError("routing decision is required");
  }

  const ruleIds = Array.isArray(decision.ruleIds) ? decision.ruleIds : [];
  const evidence = decision.evidence && typeof decision.evidence === "object"
    ? decision.evidence
    : {};

  const signals = [
    text(decision.reason),
    text(evidence.mode) ? "mode:" + text(evidence.mode) : "",
    "match-count:" + (Array.isArray(evidence.matches) ? evidence.matches.length : ruleIds.length),
    ...ruleIds.map((id) => "rule:" + text(id))
  ];

  const actionType = text(decision.action?.type);
  const actions = decision.status === "ambiguous"
    ? ["fail-closed"]
    : actionType
      ? [actionType]
      : [];

  return Object.freeze({
    reason: text(decision.reason) || "routing-decision",
    state: text(decision.status) || "unknown",
    evidence: Object.freeze({
      state: text(decision.status) || "unknown",
      signals: boundedSignals(signals),
      actions: boundedSignals(actions)
    })
  });
}
