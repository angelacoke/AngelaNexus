export const GFW_POLICY_VERSION = 1;

export const GfwStates = Object.freeze({
  DISABLED: "disabled",
  NORMAL: "normal",
  SUSPECTED: "suspected",
  CONFIRMED: "confirmed"
});

export const GfwSignals = Object.freeze({
  DNS_INJECTION: "dns-injection",
  TCP_RESET: "tcp-reset",
  TLS_SNI_FAILURE: "tls-sni-failure",
  QUIC_INITIAL_FAILURE: "quic-initial-failure",
  ACTIVE_PROBE_SUSPECTED: "active-probe-suspected",
  RESIDUAL_BLOCKING: "residual-blocking",
  REGIONAL_VARIANCE: "regional-variance",
  POISONED_DNS_DESTINATION: "poisoned-dns-destination",
  CERTIFICATE_ANOMALY: "certificate-anomaly",
  BOOTSTRAP_INTEGRITY_FAILURE: "bootstrap-integrity-failure",
  CLOCK_ANOMALY: "clock-anomaly",
  UNEXPECTED_ROUTE_CHANGE: "unexpected-route-change"
});

const SIGNAL_WEIGHTS = Object.freeze({
  [GfwSignals.DNS_INJECTION]: 3,
  [GfwSignals.TCP_RESET]: 2,
  [GfwSignals.TLS_SNI_FAILURE]: 2,
  [GfwSignals.QUIC_INITIAL_FAILURE]: 2,
  [GfwSignals.ACTIVE_PROBE_SUSPECTED]: 4,
  [GfwSignals.RESIDUAL_BLOCKING]: 2,
  [GfwSignals.REGIONAL_VARIANCE]: 1,
  [GfwSignals.POISONED_DNS_DESTINATION]: 4,
  [GfwSignals.CERTIFICATE_ANOMALY]: 4,
  [GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE]: 5,
  [GfwSignals.CLOCK_ANOMALY]: 2,
  [GfwSignals.UNEXPECTED_ROUTE_CHANGE]: 3
});

const ACTIONS = Object.freeze([
  "observe",
  "secure-dns",
  "avoid-affected-transport",
  "revalidate-path",
  "require-user-choice",
  "block-untrusted-bootstrap",
  "invalidate-suspicious-destination",
  "require-path-revalidation",
  "disable-unsafe-route"
]);

function text(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function normalizeObservation(observation = {}) {
  const signal = text(observation.signal);
  const count = positiveInt(observation.count, 1);
  const independent = observation.independent !== false;
  const transport = text(observation.transport) || null;
  const destination = text(observation.destination) || null;
  const at = Number.isFinite(Number(observation.at)) ? Number(observation.at) : null;
  return { signal, count, independent, transport, destination, at };
}

export function createGfwPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({
    enabled: source.enabled !== false,
    mode: ["monitor", "adaptive", "strict"].includes(text(source.mode)) ? text(source.mode) : "adaptive",
    failClosed: source.failClosed !== false,
    minEvidence: positiveInt(source.minEvidence, 2),
    confirmationScore: positiveInt(source.confirmationScore, 4),
    maxObservationAgeMs: positiveInt(source.maxObservationAgeMs, 10 * 60 * 1000),
    avoidQuicOnConfirmed: source.avoidQuicOnConfirmed !== false,
    requireSecureDnsOnInjection: source.requireSecureDnsOnInjection !== false
  });
}

export function validateGfwPolicy(policyInput = {}) {
  const policy = createGfwPolicy(policyInput);
  const errors = [];
  if (policy.mode === "strict" && policy.failClosed !== true) {
    errors.push(Object.freeze({
      code: "GFW_STRICT_REQUIRES_FAIL_CLOSED",
      key: "gfw.mode",
      message: "strict GFW resilience mode requires fail-closed behavior"
    }));
  }
  if (policy.minEvidence < 1) {
    errors.push(Object.freeze({
      code: "GFW_MIN_EVIDENCE_INVALID",
      key: "gfw.minEvidence",
      message: "minimum evidence must be positive"
    }));
  }
  return Object.freeze({ ok: errors.length === 0, policy, errors: Object.freeze(errors) });
}

export function classifyGfwEvidence(observations = [], options = {}) {
  const policy = createGfwPolicy(options);
  if (!policy.enabled) {
    return Object.freeze({
      version: GFW_POLICY_VERSION,
      state: GfwStates.DISABLED,
      score: 0,
      evidenceCount: 0,
      signals: Object.freeze([]),
      confidence: 0,
      actions: Object.freeze(["observe"])
    });
  }

  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const cutoff = now - policy.maxObservationAgeMs;
  const normalized = (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .filter((item) => Object.values(GfwSignals).includes(item.signal))
    .filter((item) => item.independent !== false);

  const active = normalized.filter((item) => {
    const at = Number(item.at);
    return !Number.isFinite(at) || at >= cutoff;
  });

  const signals = [...new Set(active.map((item) => item.signal))];
  const evidenceCount = active.reduce((sum, item) => sum + item.count, 0);
  const score = active.reduce((sum, item) => sum + (SIGNAL_WEIGHTS[item.signal] || 0) * item.count, 0);
  const confidence = Math.min(1, score / Math.max(policy.confirmationScore, 1));

  let state = GfwStates.NORMAL;
  if (evidenceCount >= policy.minEvidence && score >= policy.confirmationScore) state = GfwStates.CONFIRMED;
  else if (evidenceCount > 0) state = GfwStates.SUSPECTED;

  const actions = new Set(["observe"]);
  if (signals.includes(GfwSignals.POISONED_DNS_DESTINATION) || signals.includes(GfwSignals.CERTIFICATE_ANOMALY)) {
    actions.add("invalidate-suspicious-destination");
    actions.add("require-path-revalidation");
  }
  if (signals.includes(GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE)) {
    actions.add("block-untrusted-bootstrap");
    actions.add("require-path-revalidation");
  }
  if (signals.includes(GfwSignals.CLOCK_ANOMALY)) actions.add("require-path-revalidation");
  if (signals.includes(GfwSignals.UNEXPECTED_ROUTE_CHANGE)) actions.add("disable-unsafe-route");
  if (signals.includes(GfwSignals.DNS_INJECTION) && policy.requireSecureDnsOnInjection) actions.add("secure-dns");
  if (state === GfwStates.CONFIRMED && signals.includes(GfwSignals.QUIC_INITIAL_FAILURE) && policy.avoidQuicOnConfirmed) {
    actions.add("avoid-affected-transport");
  }
  if (signals.includes(GfwSignals.TCP_RESET) || signals.includes(GfwSignals.TLS_SNI_FAILURE) || signals.includes(GfwSignals.RESIDUAL_BLOCKING)) {
    actions.add("revalidate-path");
  }
  if (signals.includes(GfwSignals.ACTIVE_PROBE_SUSPECTED)) {
    actions.add("require-user-choice");
    actions.add("require-path-revalidation");
  }

  return Object.freeze({
    version: GFW_POLICY_VERSION,
    state,
    score,
    evidenceCount,
    signals: Object.freeze(signals),
    confidence,
    actions: Object.freeze([...actions])
  });
}

export function recommendGfwResilience(evidence, context = {}) {
  const result = evidence && typeof evidence === "object" ? evidence : {};
  const signals = new Set(Array.isArray(result.signals) ? result.signals : []);
  const available = new Set(Array.isArray(context.availableCapabilities) ? context.availableCapabilities.map(text) : []);
  const recommendations = [];

  if (result.state === GfwStates.DISABLED || result.state === GfwStates.NORMAL) {
    return Object.freeze({ state: result.state || GfwStates.NORMAL, recommendations: Object.freeze([]), requiresUserChoice: false });
  }

  if (signals.has(GfwSignals.POISONED_DNS_DESTINATION) || signals.has(GfwSignals.CERTIFICATE_ANOMALY)) {
    recommendations.push({
      type: "destination-integrity",
      action: "invalidate-suspicious-destination",
      reason: "destination integrity evidence is inconsistent with the trusted connection state",
      requiresUserChoice: false
    });
  }

  if (signals.has(GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE)) {
    recommendations.push({
      type: "bootstrap",
      action: "block-untrusted-bootstrap",
      reason: "bootstrap integrity cannot be established",
      requiresUserChoice: false
    });
  }

  if (signals.has(GfwSignals.DNS_INJECTION)) {
    recommendations.push({
      type: "dns",
      action: "secure-dns",
      reason: "DNS injection evidence is present",
      requiresUserChoice: false
    });
  }

  if (signals.has(GfwSignals.QUIC_INITIAL_FAILURE) && result.state === GfwStates.CONFIRMED) {
    recommendations.push({
      type: "transport",
      action: available.has("quic") ? "avoid-affected-transport" : "revalidate-path",
      transport: "quic",
      reason: "QUIC-specific censorship evidence is present",
      requiresUserChoice: false
    });
  }

  if (signals.has(GfwSignals.ACTIVE_PROBE_SUSPECTED)) {
    recommendations.push({
      type: "path",
      action: "require-user-choice",
      reason: "active probing cannot be safely inferred or mitigated from a single local failure",
      requiresUserChoice: true
    });
  }

  if (signals.has(GfwSignals.TCP_RESET) || signals.has(GfwSignals.TLS_SNI_FAILURE) || signals.has(GfwSignals.RESIDUAL_BLOCKING) || signals.has(GfwSignals.UNEXPECTED_ROUTE_CHANGE) || signals.has(GfwSignals.CLOCK_ANOMALY)) {
    recommendations.push({
      type: "path",
      action: "revalidate-path",
      reason: "connection-level blocking evidence is present",
      requiresUserChoice: false
    });
  }

  return Object.freeze({
    state: result.state || GfwStates.SUSPECTED,
    recommendations: Object.freeze(recommendations.map((item) => Object.freeze(item))),
    requiresUserChoice: recommendations.some((item) => item.requiresUserChoice)
  });
}
