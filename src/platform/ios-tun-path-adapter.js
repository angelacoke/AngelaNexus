import { IOSCapabilities, IOSCapabilityStates } from "./ios-capabilities.js";
import { PathRegistryStates } from "../core/path-registry.js";

export const IOS_TUN_PATH_ADAPTER_VERSION = 1;

export const IOSTunStates = Object.freeze({
  CREATED: "created",
  UP: "up",
  RUNNING: "running",
});

const NATIVE_STATES = new Set(Object.values(IOSTunStates));

function normalizeProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return {
      state: IOSCapabilityStates.FAILED,
      reason: "tun-probe-missing",
      evidence: Object.freeze({}),
    };
  }
  return {
    state: probe.state,
    reason: typeof probe.reason === "string" ? probe.reason : null,
    evidence: probe.evidence && typeof probe.evidence === "object" ? probe.evidence : {},
  };
}

/**
 * Synchronizes iOS packet-tunnel probe evidence into the platform path registry.
 *
 * Fail-closed rules:
 * - an unverified or missing tunnel probe quarantines the path;
 * - explicit user denial always blocks admission.
 *
 * iOS has no per-process TUN exclusion surface at the packet-tunnel layer;
 * app-scoped routing belongs to the APP_PROXY capability and the platform
 * application-routing contracts, not to this adapter.
 *
 * Probe evidence is evidence only; it does not claim production readiness.
 */
export function syncIOSTunPath({
  capabilityRegistry,
  pathRegistry,
  probeResult,
  pathId = "ios-tun",
  routeReady = false,
  dnsReady = false,
  securityHealthy = false,
  userAllowed = true,
} = {}) {
  if (!capabilityRegistry || typeof capabilityRegistry.set !== "function") {
    return Object.freeze({ ok: false, reason: "capability-registry-required" });
  }
  if (!pathRegistry || typeof pathRegistry.register !== "function") {
    return Object.freeze({ ok: false, reason: "path-registry-required" });
  }
  if (typeof pathId !== "string" || !pathId.trim()) {
    return Object.freeze({ ok: false, reason: "path-id-required" });
  }

  const probe = normalizeProbe(probeResult);
  const tunVerified =
    probe.state === IOSCapabilityStates.VERIFIED &&
    NATIVE_STATES.has(probe.evidence.tunState);

  capabilityRegistry.set(IOSCapabilities.PACKET_TUNNEL, {
    state: tunVerified ? IOSCapabilityStates.VERIFIED : IOSCapabilityStates.FAILED,
    reason: tunVerified ? "tun-state-verified" : (probe.reason || "tun-state-not-verified"),
    evidence: {
      ...probe.evidence,
      capability: IOSCapabilities.PACKET_TUNNEL,
      tunVerified,
      routeReady: Boolean(routeReady),
      dnsReady: Boolean(dnsReady),
    },
  });

  const ready = tunVerified && Boolean(routeReady) && Boolean(dnsReady) &&
    Boolean(securityHealthy);
  const state = tunVerified
    ? (ready ? PathRegistryStates.ACTIVE : PathRegistryStates.DISABLED)
    : PathRegistryStates.QUARANTINED;

  const result = pathRegistry.register({
    id: pathId.trim(),
    type: "kernel-tunnel",
    platform: "ios",
    state,
    trust: tunVerified ? "verified" : "rejected",
    verified: tunVerified,
    securityHealthy: Boolean(securityHealthy) && tunVerified,
    userAllowed: userAllowed !== false,
    readiness: {
      tun: tunVerified,
      route: Boolean(routeReady),
      dns: Boolean(dnsReady),
    },
    evidence: {
      ...probe.evidence,
      tunState: probe.evidence.tunState || null,
    },
  });

  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    capability: capabilityRegistry.get(IOSCapabilities.PACKET_TUNNEL),
    path: result.path,
    admissible: ready && userAllowed !== false,
  });
}
