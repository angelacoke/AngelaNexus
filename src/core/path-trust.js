export const PATH_TRUST_VERSION = 1;

export const PathTrustStates = Object.freeze({
  UNKNOWN: "unknown",
  TRUSTED: "trusted",
  DEGRADED: "degraded",
  UNTRUSTED: "untrusted",
  REVALIDATION_REQUIRED: "revalidation-required"
});

export const PathTrustActions = Object.freeze({
  ACCEPT: "accept",
  REVALIDATE: "revalidate",
  FAIL_CLOSED: "fail-closed"
});

export const PathTrustSignals = Object.freeze({
  NETWORK_CHANGED: "network-changed",
  ROUTE_CHANGED: "route-changed",
  DNS_PATH_CHANGED: "dns-path-changed",
  DESTINATION_CHANGED: "destination-changed",
  TRANSPORT_CHANGED: "transport-changed",
  CERTIFICATE_CHANGED: "certificate-changed",
  BOOTSTRAP_CHANGED: "bootstrap-changed",
  ROUTE_INCONSISTENT: "route-inconsistent",
  DNS_PATH_INCONSISTENT: "dns-path-inconsistent",
  DESTINATION_INTEGRITY_FAILURE: "destination-integrity-failure",
  CERTIFICATE_INTEGRITY_FAILURE: "certificate-integrity-failure",
  BOOTSTRAP_INTEGRITY_FAILURE: "bootstrap-integrity-failure",
  CLOCK_ROLLBACK: "clock-rollback"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function normalizeId(value) {
  const normalized = text(value);
  return normalized || null;
}

function normalizeGeneration(value) {
  return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

function normalizeSnapshot(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return Object.freeze({
    networkId: normalizeId(source.networkId),
    networkGeneration: normalizeGeneration(source.networkGeneration),
    routeId: normalizeId(source.routeId),
    dnsPathId: normalizeId(source.dnsPathId),
    destinationId: normalizeId(source.destinationId),
    transport: normalizeId(source.transport),
    certificateId: normalizeId(source.certificateId),
    bootstrapId: normalizeId(source.bootstrapId),
    routeConsistent: source.routeConsistent !== false,
    dnsPathConsistent: source.dnsPathConsistent !== false,
    destinationTrusted: source.destinationTrusted !== false,
    certificateTrusted: source.certificateTrusted !== false,
    bootstrapTrusted: source.bootstrapTrusted !== false
  });
}

export function createPathTrustPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({
    version: PATH_TRUST_VERSION,
    failClosed: source.failClosed !== false,
    requireNetworkIdentity: source.requireNetworkIdentity !== false,
    requireNetworkGeneration: source.requireNetworkGeneration !== false,
    requireRouteIdentity: source.requireRouteIdentity !== false,
    requireDnsPathIdentity: source.requireDnsPathIdentity !== false,
    requireDestinationIdentity: source.requireDestinationIdentity !== false,
    requireTransportIdentity: source.requireTransportIdentity !== false,
    requireCertificateIntegrity: source.requireCertificateIntegrity !== false,
    requireBootstrapIntegrity: source.requireBootstrapIntegrity !== false
  });
}

export function validatePathTrustPolicy(input = {}) {
  const policy = createPathTrustPolicy(input);
  const errors = [];
  if (policy.failClosed !== true) {
    errors.push(Object.freeze({
      code: "PATH_TRUST_FAIL_CLOSED_REQUIRED",
      key: "pathTrust.failClosed",
      message: "path trust requires fail-closed behavior"
    }));
  }
  return Object.freeze({ ok: errors.length === 0, policy, errors: Object.freeze(errors) });
}

export function evaluatePathTrust({
  expected = {},
  observed = {},
  previous = null,
  policy: policyInput = {}
} = {}) {
  const policy = createPathTrustPolicy(policyInput);
  const target = normalizeSnapshot(expected);
  const actual = normalizeSnapshot(observed);
  const prior = previous ? normalizeSnapshot(previous) : null;
  const signals = [];
  const reasons = [];

  if (policy.requireNetworkIdentity && !actual.networkId) {
    signals.push(PathTrustSignals.NETWORK_CHANGED);
    reasons.push("network-identity-unavailable");
  } else if (target.networkId && actual.networkId !== target.networkId) {
    signals.push(PathTrustSignals.NETWORK_CHANGED);
    reasons.push("network-identity-mismatch");
  }

  if (policy.requireNetworkGeneration && actual.networkGeneration === null) {
    signals.push(PathTrustSignals.NETWORK_CHANGED);
    reasons.push("network-generation-unavailable");
  } else if (
    target.networkGeneration !== null &&
    actual.networkGeneration !== target.networkGeneration
  ) {
    signals.push(PathTrustSignals.NETWORK_CHANGED);
    reasons.push("network-generation-mismatch");
  }

  if (policy.requireRouteIdentity && !actual.routeId) {
    signals.push(PathTrustSignals.ROUTE_CHANGED);
    reasons.push("route-identity-unavailable");
  } else if (target.routeId && actual.routeId !== target.routeId) {
    signals.push(PathTrustSignals.ROUTE_CHANGED);
    reasons.push("route-identity-mismatch");
  }

  if (policy.requireDnsPathIdentity && !actual.dnsPathId) {
    signals.push(PathTrustSignals.DNS_PATH_CHANGED);
    reasons.push("dns-path-identity-unavailable");
  } else if (target.dnsPathId && actual.dnsPathId !== target.dnsPathId) {
    signals.push(PathTrustSignals.DNS_PATH_CHANGED);
    reasons.push("dns-path-identity-mismatch");
  }

  if (policy.requireDestinationIdentity && !actual.destinationId) {
    signals.push(PathTrustSignals.DESTINATION_CHANGED);
    reasons.push("destination-identity-unavailable");
  } else if (target.destinationId && actual.destinationId !== target.destinationId) {
    signals.push(PathTrustSignals.DESTINATION_CHANGED);
    reasons.push("destination-identity-mismatch");
  }

  if (policy.requireTransportIdentity && !actual.transport) {
    signals.push(PathTrustSignals.TRANSPORT_CHANGED);
    reasons.push("transport-identity-unavailable");
  } else if (target.transport && actual.transport !== target.transport) {
    signals.push(PathTrustSignals.TRANSPORT_CHANGED);
    reasons.push("transport-identity-mismatch");
  }

  if (!actual.routeConsistent) {
    signals.push(PathTrustSignals.ROUTE_INCONSISTENT);
    reasons.push("route-integrity-failed");
  }
  if (!actual.dnsPathConsistent) {
    signals.push(PathTrustSignals.DNS_PATH_INCONSISTENT);
    reasons.push("dns-path-integrity-failed");
  }

  if (policy.requireDestinationIdentity && !actual.destinationTrusted) {
    signals.push(PathTrustSignals.DESTINATION_INTEGRITY_FAILURE);
    reasons.push("destination-integrity-failed");
  }
  if (policy.requireCertificateIntegrity && !actual.certificateTrusted) {
    signals.push(PathTrustSignals.CERTIFICATE_INTEGRITY_FAILURE);
    reasons.push("certificate-integrity-failed");
  }
  if (policy.requireBootstrapIntegrity && !actual.bootstrapTrusted) {
    signals.push(PathTrustSignals.BOOTSTRAP_INTEGRITY_FAILURE);
    reasons.push("bootstrap-integrity-failed");
  }

  if (prior) {
    if (prior.routeId && actual.routeId && prior.routeId !== actual.routeId) {
      signals.push(PathTrustSignals.ROUTE_CHANGED);
    }
    if (prior.dnsPathId && actual.dnsPathId && prior.dnsPathId !== actual.dnsPathId) {
      signals.push(PathTrustSignals.DNS_PATH_CHANGED);
    }
    if (prior.destinationId && actual.destinationId && prior.destinationId !== actual.destinationId) {
      signals.push(PathTrustSignals.DESTINATION_CHANGED);
    }
    if (prior.transport && actual.transport && prior.transport !== actual.transport) {
      signals.push(PathTrustSignals.TRANSPORT_CHANGED);
    }
    if (prior.certificateId && actual.certificateId && prior.certificateId !== actual.certificateId) {
      signals.push(PathTrustSignals.CERTIFICATE_CHANGED);
    }
    if (prior.bootstrapId && actual.bootstrapId && prior.bootstrapId !== actual.bootstrapId) {
      signals.push(PathTrustSignals.BOOTSTRAP_CHANGED);
    }
  }

  const uniqueSignals = [...new Set(signals)];
  const severe = uniqueSignals.some((signal) =>
    signal === PathTrustSignals.ROUTE_INCONSISTENT ||
    signal === PathTrustSignals.DNS_PATH_INCONSISTENT ||
    signal === PathTrustSignals.DESTINATION_INTEGRITY_FAILURE ||
    signal === PathTrustSignals.CERTIFICATE_INTEGRITY_FAILURE ||
    signal === PathTrustSignals.BOOTSTRAP_INTEGRITY_FAILURE ||
    signal === PathTrustSignals.NETWORK_CHANGED
  );

  const state = uniqueSignals.length === 0
    ? PathTrustStates.TRUSTED
    : (severe ? PathTrustStates.UNTRUSTED : PathTrustStates.REVALIDATION_REQUIRED);

  return Object.freeze({
    version: PATH_TRUST_VERSION,
    state,
    trusted: state === PathTrustStates.TRUSTED,
    action: state === PathTrustStates.TRUSTED
      ? PathTrustActions.ACCEPT
      : (policy.failClosed ? PathTrustActions.FAIL_CLOSED : PathTrustActions.REVALIDATE),
    signals: Object.freeze(uniqueSignals),
    reasons: Object.freeze([...new Set(reasons)]),
    expected: target,
    observed: actual
  });
}

export function createPathTrustSession(overrides = {}) {
  let expected = normalizeSnapshot(overrides.expected);
  let previous = null;
  let invalidated = true;
  const listeners = new Set();

  function emit(result) {
    if (result.trusted) return;
    const event = Object.freeze({
      reason: result.reasons[0] || "path-trust-invalidated",
      state: result.state,
      action: result.action,
      signals: Object.freeze([...result.signals]),
      reasons: Object.freeze([...result.reasons]),
      ...(result.evidence ? { evidence: result.evidence } : {})
    });
    for (const listener of listeners) {
      try { listener(event); } catch {}
    }
  }

  function validate(observed) {
    const result = evaluatePathTrust({
      expected,
      observed,
      previous,
      policy: overrides.policy || {}
    });
    previous = normalizeSnapshot(observed);
    invalidated = !result.trusted;
    emit(result);
    return result;
  }

  return Object.freeze({
    establish(observed) {
      const snapshot = normalizeSnapshot(observed);
      expected = snapshot;
      previous = snapshot;
      invalidated = false;
      return Object.freeze({
        version: PATH_TRUST_VERSION,
        state: PathTrustStates.TRUSTED,
        trusted: true,
        action: PathTrustActions.ACCEPT,
        signals: Object.freeze([]),
        reasons: Object.freeze([]),
        expected: snapshot,
        observed: snapshot
      });
    },
    validate,
    invalidate(reason = "explicit-invalidation") {
      invalidated = true;
      const evidence = reason && typeof reason === "object" ? structuredClone(reason) : null;
      const normalizedReason = evidence && typeof evidence.reason === "string"
        ? text(evidence.reason)
        : text(reason);
      const signals = evidence && Array.isArray(evidence.signals)
        ? [...new Set(evidence.signals.filter(signal => typeof signal === "string"))]
        : [PathTrustSignals.ROUTE_CHANGED];
      const result = Object.freeze({
        version: PATH_TRUST_VERSION,
        state: PathTrustStates.REVALIDATION_REQUIRED,
        trusted: false,
        action: PathTrustActions.FAIL_CLOSED,
        signals: Object.freeze(signals.length ? signals : [PathTrustSignals.ROUTE_CHANGED]),
        reasons: Object.freeze([normalizedReason || "explicit-invalidation"]),
        expected,
        observed: previous || expected,
        ...(evidence ? { evidence } : {})
      });
      emit(result);
      return result;
    },
    subscribeInvalidation(listener) {
      if (typeof listener !== "function") throw new TypeError("path trust listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return Object.freeze({
        version: PATH_TRUST_VERSION,
        expected,
        previous,
        invalidated
      });
    }
  });
}
