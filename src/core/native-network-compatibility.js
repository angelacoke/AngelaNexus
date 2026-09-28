export const NATIVE_NETWORK_COMPATIBILITY_VERSION = 1;

export const NetworkInterfaceModes = Object.freeze({
  NATIVE: "native",
  TUN: "tun"
});

export const NetworkCompatibilityActions = Object.freeze({
  ACCEPT: "accept",
  REVALIDATE: "revalidate",
  FAIL_CLOSED: "fail-closed"
});

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function nonNegativeInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function normalizeBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMode(value) {
  return value === NetworkInterfaceModes.NATIVE ? NetworkInterfaceModes.NATIVE : NetworkInterfaceModes.TUN;
}

export function createNativeNetworkCompatibilityPolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return Object.freeze({
    version: NATIVE_NETWORK_COMPATIBILITY_VERSION,
    mode: normalizeMode(source.mode),
    preserveIpv4Ipv6Semantics: normalizeBool(source.preserveIpv4Ipv6Semantics, true),
    requireRouteConsistency: normalizeBool(source.requireRouteConsistency, true),
    requireDnsPathConsistency: normalizeBool(source.requireDnsPathConsistency, true),
    allowIpv6: normalizeBool(source.allowIpv6, true),
    preventDnsLeak: normalizeBool(source.preventDnsLeak, true),
    preventRouteLeak: normalizeBool(source.preventRouteLeak, true),
    autoMtu: normalizeBool(source.autoMtu, true),
    mtu: positiveInt(source.mtu, 1500),
    udpTimeoutMs: positiveInt(source.udpTimeoutMs, 120000),
    networkChangeRevalidationMs: positiveInt(source.networkChangeRevalidationMs, 5000),
    failClosed: normalizeBool(source.failClosed, true),
    directFallback: false,
    deviceIdentitySpoofing: false
  });
}

export function validateNativeNetworkCompatibilityPolicy(policyInput = {}) {
  const policy = createNativeNetworkCompatibilityPolicy(policyInput);
  const errors = [];

  if (policy.directFallback !== false) {
    errors.push(Object.freeze({
      code: "NATIVE_NETWORK_DIRECT_FALLBACK_FORBIDDEN",
      key: "compatibility.directFallback",
      message: "native network compatibility must not introduce a direct fallback"
    }));
  }

  if (policy.deviceIdentitySpoofing !== false) {
    errors.push(Object.freeze({
      code: "NATIVE_NETWORK_IDENTITY_SPOOFING_FORBIDDEN",
      key: "compatibility.deviceIdentitySpoofing",
      message: "network compatibility must not spoof device identity"
    }));
  }

  if (policy.failClosed !== true) {
    errors.push(Object.freeze({
      code: "NATIVE_NETWORK_FAIL_CLOSED_REQUIRED",
      key: "compatibility.failClosed",
      message: "network compatibility requires fail-closed behavior"
    }));
  }

  if (policy.requireRouteConsistency !== true || policy.requireDnsPathConsistency !== true) {
    errors.push(Object.freeze({
      code: "NATIVE_NETWORK_PATH_CONSISTENCY_REQUIRED",
      key: "compatibility.pathConsistency",
      message: "route and DNS path consistency are required"
    }));
  }

  return Object.freeze({ ok: errors.length === 0, policy, errors: Object.freeze(errors) });
}

function normalizeEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "object") return null;
  const ipVersion = endpoint.ipVersion === 6 ? 6 : endpoint.ipVersion === 4 ? 4 : null;
  const family = endpoint.family === "ipv6" || endpoint.family === "ipv4" ? endpoint.family : null;
  const routeId = typeof endpoint.routeId === "string" && endpoint.routeId.trim() ? endpoint.routeId.trim() : null;
  const dnsPathId = typeof endpoint.dnsPathId === "string" && endpoint.dnsPathId.trim() ? endpoint.dnsPathId.trim() : null;
  return Object.freeze({ ipVersion, family, routeId, dnsPathId });
}

export function evaluateNativeNetworkConsistency(input = {}, policyInput = {}) {
  const policy = createNativeNetworkCompatibilityPolicy(policyInput);
  const source = input && typeof input === "object" ? input : {};
  const destination = normalizeEndpoint(source.destination);
  const routeId = typeof source.routeId === "string" && source.routeId.trim() ? source.routeId.trim() : null;
  const dnsPathId = typeof source.dnsPathId === "string" && source.dnsPathId.trim() ? source.dnsPathId.trim() : null;
  const dnsAddress = normalizeEndpoint(source.dnsAddress);
  const reasons = [];

  if (!destination) reasons.push("destination-unavailable");
  if (!routeId) reasons.push("route-unavailable");
  if (policy.requireRouteConsistency && destination && destination.routeId && destination.routeId !== routeId) {
    reasons.push("route-mismatch");
  }

  if (policy.requireDnsPathConsistency) {
    if (!dnsPathId) reasons.push("dns-path-unavailable");
    if (destination && destination.dnsPathId && destination.dnsPathId !== dnsPathId) {
      reasons.push("dns-path-mismatch");
    }
  }

  if (policy.preventDnsLeak && dnsAddress && destination) {
    if (dnsAddress.ipVersion !== null && destination.ipVersion !== null && dnsAddress.ipVersion !== destination.ipVersion) {
      reasons.push("dns-address-family-mismatch");
    }
  }

  if (!policy.allowIpv6 && destination && destination.ipVersion === 6) {
    reasons.push("ipv6-disabled");
  }

  if (policy.preserveIpv4Ipv6Semantics && destination && destination.ipVersion === null) {
    reasons.push("destination-family-unknown");
  }

  const allowed = reasons.length === 0;
  return Object.freeze({
    version: NATIVE_NETWORK_COMPATIBILITY_VERSION,
    allowed,
    action: allowed ? NetworkCompatibilityActions.ACCEPT : (
      policy.failClosed ? NetworkCompatibilityActions.FAIL_CLOSED : NetworkCompatibilityActions.REVALIDATE
    ),
    reasons: Object.freeze(reasons)
  });
}

export function createNativeNetworkSessionState(input = {}, policyInput = {}) {
  const policy = createNativeNetworkCompatibilityPolicy(policyInput);
  const source = input && typeof input === "object" ? input : {};
  const networkId = typeof source.networkId === "string" && source.networkId.trim() ? source.networkId.trim() : null;
  const generation = nonNegativeInt(source.generation, 0);
  return Object.freeze({
    version: NATIVE_NETWORK_COMPATIBILITY_VERSION,
    networkId,
    generation,
    mode: policy.mode,
    requiresRevalidation: true,
    failClosed: policy.failClosed,
    directFallback: false,
    nextRevalidationInMs: policy.networkChangeRevalidationMs
  });
}
