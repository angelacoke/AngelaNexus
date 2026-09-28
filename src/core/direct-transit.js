export const DIRECT_TRANSIT_VERSION = 1;

export const DirectTransitActions = Object.freeze({
  NATIVE: "native",
  REVALIDATE: "revalidate",
  FAIL_CLOSED: "fail-closed",
});

export const DirectTransitCapabilities = Object.freeze({
  NATIVE_SOCKET_PATH: "native-socket-path",
  NATIVE_ROUTE: "native-route",
  BYPASS_TUN: "bypass-tun",
  ROUTE_INTEGRITY: "route-integrity",
});

const REQUIRED_CAPABILITIES = Object.freeze([
  DirectTransitCapabilities.NATIVE_SOCKET_PATH,
  DirectTransitCapabilities.NATIVE_ROUTE,
  DirectTransitCapabilities.BYPASS_TUN,
  DirectTransitCapabilities.ROUTE_INTEGRITY,
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(field + " must be a non-empty string");
  return value.trim();
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) throw new TypeError("direct transit capabilities must be an array");
  return [...new Set(capabilities.map((value) => nonEmptyString(value, "direct transit capability")))];
}

export function createDirectTransitPolicy({
  enabled = true,
  requireNativeSocketPath = true,
  requireNativeRoute = true,
  bypassTun = true,
  requireRouteIntegrity = true,
  requireDnsPathConsistency = true,
  failClosed = true,
} = {}) {
  if (failClosed !== true) throw new Error("direct transit requires fail-closed behavior");
  if (bypassTun !== true) throw new Error("direct transit must bypass TUN");
  if (requireNativeSocketPath !== true) throw new Error("direct transit requires native socket path");
  if (requireNativeRoute !== true) throw new Error("direct transit requires native route");
  if (requireRouteIntegrity !== true) throw new Error("direct transit requires route integrity");
  return Object.freeze({
    version: DIRECT_TRANSIT_VERSION,
    enabled: enabled !== false,
    requireNativeSocketPath,
    requireNativeRoute,
    bypassTun,
    requireRouteIntegrity,
    requireDnsPathConsistency: requireDnsPathConsistency !== false,
    failClosed,
  });
}

export function validateDirectTransitCapabilities(capabilities, policy = createDirectTransitPolicy()) {
  const normalized = normalizeCapabilities(capabilities);
  if (policy.enabled !== true) return Object.freeze({ ok: true, missing: Object.freeze([]), capabilities: Object.freeze(normalized) });
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !normalized.includes(capability));
  return Object.freeze({
    ok: missing.length === 0,
    missing: Object.freeze(missing),
    capabilities: Object.freeze(normalized),
  });
}

export function evaluateDirectTransit({
  policy = createDirectTransitPolicy(),
  capabilities = [],
  tunEntered = false,
  proxyEntered = false,
  route = {},
  dnsPath = {},
  networkGeneration,
  validatedNetworkGeneration,
} = {}) {
  if (!policy.enabled) return Object.freeze({ action: DirectTransitActions.REVALIDATE, reasons: Object.freeze(["direct-transit-disabled"]) });

  const capabilityState = validateDirectTransitCapabilities(capabilities, policy);
  if (!capabilityState.ok) {
    return Object.freeze({
      action: policy.failClosed ? DirectTransitActions.FAIL_CLOSED : DirectTransitActions.REVALIDATE,
      reasons: Object.freeze(["missing-native-capability:" + capabilityState.missing.join(",")]),
    });
  }

  if (tunEntered || proxyEntered) {
    return Object.freeze({
      action: DirectTransitActions.FAIL_CLOSED,
      reasons: Object.freeze(["sensitive-flow-entered-proxy-path"]),
    });
  }

  if (networkGeneration !== undefined && networkGeneration !== validatedNetworkGeneration) {
    return Object.freeze({
      action: DirectTransitActions.REVALIDATE,
      reasons: Object.freeze(["network-generation-changed"]),
    });
  }

  if (policy.requireNativeRoute && route.native !== true) {
    return Object.freeze({
      action: DirectTransitActions.FAIL_CLOSED,
      reasons: Object.freeze(["native-route-not-established"]),
    });
  }

  if (policy.requireRouteIntegrity && route.consistent !== true) {
    return Object.freeze({
      action: DirectTransitActions.FAIL_CLOSED,
      reasons: Object.freeze(["route-integrity-failed"]),
    });
  }

  if (policy.requireDnsPathConsistency && dnsPath.consistent !== true) {
    return Object.freeze({
      action: DirectTransitActions.FAIL_CLOSED,
      reasons: Object.freeze(["dns-path-inconsistent"]),
    });
  }

  return Object.freeze({
    action: DirectTransitActions.NATIVE,
    reasons: Object.freeze(["native-network-path-validated"]),
  });
}

export function createDirectTransitSessionState({
  networkGeneration = 0,
  validatedNetworkGeneration = null,
} = {}) {
  return Object.freeze({
    version: DIRECT_TRANSIT_VERSION,
    networkGeneration,
    validatedNetworkGeneration,
    revalidationRequired: networkGeneration !== validatedNetworkGeneration,
    proxyPathEntered: false,
  });
}
