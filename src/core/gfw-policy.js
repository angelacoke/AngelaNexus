export const GFW_POLICY_VERSION = 2;

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

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
    confirmationScore: positiveNumber(source.confirmationScore, 4),
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


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRuntimePolicy(overrides = {}) {
  const policy = createGfwPolicy(overrides);
  return Object.freeze({
    ...policy,
    decayHalfLifeMs: positiveInt(overrides.decayHalfLifeMs, 2 * 60 * 1000),
    recoveryQuietPeriodMs: positiveInt(overrides.recoveryQuietPeriodMs, 3 * 60 * 1000),
    maxObservations: positiveInt(overrides.maxObservations, 256),
    confirmationDiversity: positiveInt(overrides.confirmationDiversity, 2)
  });
}

/**
 * Event-driven GFW resilience controller.
 *
 * The controller keeps a bounded, time-decayed evidence window. It does not
 * run a polling loop: each observation immediately updates the decision, and
 * snapshot() re-evaluates it against the supplied clock. This keeps idle
 * memory/CPU cost low while allowing decisions to change as network evidence
 * changes.
 */
export function createGfwRuntime(overrides = {}) {
  const policy = normalizeRuntimePolicy(overrides);
  const observations = [];
  let lastNow = 0;
  let lastState = GfwStates.NORMAL;
  let lastEvidenceAt = null;

  function prune(now) {
    const cutoff = now - policy.maxObservationAgeMs;
    while (observations.length > 0 && observations[0].at < cutoff) observations.shift();
    if (observations.length > policy.maxObservations) {
      observations.splice(0, observations.length - policy.maxObservations);
    }
  }

  function scoreObservation(item, now) {
    const age = Math.max(0, now - item.at);
    const decay = Math.pow(0.5, age / policy.decayHalfLifeMs);
    return (SIGNAL_WEIGHTS[item.signal] || 0) * item.count * decay;
  }

  function evaluate(now) {
    const current = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (current < lastNow) {
      return Object.freeze({
        version: GFW_POLICY_VERSION,
        state: lastState,
        score: 0,
        evidenceCount: 0,
        signals: Object.freeze([]),
        confidence: 0,
        actions: Object.freeze(["observe", "require-path-revalidation"]),
        clockRollback: true
      });
    }
    lastNow = current;
    prune(current);

    const active = observations.filter((item) => item.independent !== false);
    const scores = active.map((item) => scoreObservation(item, current));
    const score = scores.reduce((sum, value) => sum + value, 0);
    const signals = [...new Set(active.map((item) => item.signal))];
    const transports = [...new Set(active.map((item) => item.transport).filter(Boolean))];
    const destinations = [...new Set(active.map((item) => item.destination).filter(Boolean))];
    const diversity = new Set(active.map((item) => item.signal)).size;
    const corroborated = diversity >= policy.confirmationDiversity;
    const evidenceCount = active.reduce((sum, item) => sum + item.count, 0);
    const confidence = clamp(
      (score / Math.max(policy.confirmationScore, 1)) * (corroborated ? 1 : 0.65),
      0,
      1
    );

    const severe = signals.some((signal) =>
      signal === GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE ||
      signal === GfwSignals.POISONED_DNS_DESTINATION ||
      signal === GfwSignals.CERTIFICATE_ANOMALY
    );

    let state = lastState;
    if (severe && evidenceCount >= 1) {
      state = GfwStates.CONFIRMED;
    } else if (
      evidenceCount >= policy.minEvidence &&
      score >= policy.confirmationScore &&
      corroborated
    ) {
      state = GfwStates.CONFIRMED;
    } else if (evidenceCount > 0) {
      state = GfwStates.SUSPECTED;
    } else if (
      lastEvidenceAt !== null &&
      current - lastEvidenceAt >= policy.recoveryQuietPeriodMs &&
      score < policy.confirmationScore * 0.25
    ) {
      state = GfwStates.NORMAL;
    } else if (
      lastState === GfwStates.CONFIRMED &&
      lastEvidenceAt !== null &&
      current - lastEvidenceAt < policy.recoveryQuietPeriodMs
    ) {
      state = GfwStates.SUSPECTED;
    } else {
      state = GfwStates.NORMAL;
    }

    const actions = new Set(["observe"]);
    if (
      signals.includes(GfwSignals.POISONED_DNS_DESTINATION) ||
      signals.includes(GfwSignals.CERTIFICATE_ANOMALY)
    ) {
      actions.add("invalidate-suspicious-destination");
      actions.add("require-path-revalidation");
    }
    if (signals.includes(GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE)) {
      actions.add("block-untrusted-bootstrap");
      actions.add("require-path-revalidation");
    }
    if (signals.includes(GfwSignals.DNS_INJECTION) && policy.requireSecureDnsOnInjection) {
      actions.add("secure-dns");
    }
    if (
      state === GfwStates.CONFIRMED &&
      signals.includes(GfwSignals.QUIC_INITIAL_FAILURE) &&
      policy.avoidQuicOnConfirmed
    ) {
      actions.add("avoid-affected-transport");
    }
    if (
      signals.includes(GfwSignals.TCP_RESET) ||
      signals.includes(GfwSignals.TLS_SNI_FAILURE) ||
      signals.includes(GfwSignals.RESIDUAL_BLOCKING) ||
      signals.includes(GfwSignals.CLOCK_ANOMALY)
    ) {
      actions.add("revalidate-path");
    }
    if (signals.includes(GfwSignals.UNEXPECTED_ROUTE_CHANGE)) actions.add("disable-unsafe-route");
    if (signals.includes(GfwSignals.ACTIVE_PROBE_SUSPECTED)) {
      actions.add("require-user-choice");
      actions.add("require-path-revalidation");
    }
    if (state === GfwStates.CONFIRMED && policy.failClosed) actions.add("fail-closed");

    return Object.freeze({
      version: GFW_POLICY_VERSION,
      state,
      score,
      evidenceCount,
      signals: Object.freeze(signals),
      confidence,
      diversity,
      corroborated,
      transports: Object.freeze(transports),
      destinations: Object.freeze(destinations),
      actions: Object.freeze([...actions]),
      clockRollback: false
    });
  }

  return Object.freeze({
    observe(observation = {}, now = Date.now()) {
      const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
      const item = normalizeObservation({ ...observation, at });
      if (!Object.values(GfwSignals).includes(item.signal) || item.independent === false) {
        return evaluate(at);
      }
      if (at < lastNow) return evaluate(at);
      observations.push(item);
      lastEvidenceAt = at;
      lastState = item.signal === GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE ||
        item.signal === GfwSignals.POISONED_DNS_DESTINATION ||
        item.signal === GfwSignals.CERTIFICATE_ANOMALY
        ? GfwStates.CONFIRMED
        : GfwStates.SUSPECTED;
      return evaluate(at);
    },
    snapshot(now = Date.now()) {
      return evaluate(now);
    },
    clear(now = Date.now()) {
      observations.length = 0;
      lastEvidenceAt = null;
      lastState = GfwStates.NORMAL;
      lastNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
      return evaluate(lastNow);
    },
    size() {
      return observations.length;
    },
    policy
  });
}
