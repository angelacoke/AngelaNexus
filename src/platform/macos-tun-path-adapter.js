import { MacOSCapabilities, MacOSCapabilityStates } from "./macos-capabilities.js";
import { PathRegistryStates } from "../core/path-registry.js";

export const MACOS_TUN_PATH_ADAPTER_VERSION = 1;

export const MacOSTunStates = Object.freeze({
  CREATED: "created",
  UP: "up",
  RUNNING: "running",
});

const NATIVE_STATES = new Set(Object.values(MacOSTunStates));

function normalizeProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return {
      state: MacOSCapabilityStates.FAILED,
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
 * Synchronizes macOS packet-tunnel probe evidence into the platform path registry.
 *
 * Fail-closed rules:
 * - an unverified or missing tunnel probe quarantines the path;
 * - when the caller requires process exclusion, an unevidenced process-exclusion
 *   capability blocks admission instead of silently widening scope;
 * - explicit user denial always blocks admission.
 *
 * Probe evidence is evidence only; it does not claim production readiness.
 */
export function syncMacOSTunPath({
  capabilityRegistry,
  pathRegistry,
  probeResult,
  pathId = "macos-tun",
  routeReady = false,
  dnsReady = false,
  securityHealthy = false,
  userAllowed = true,
  processExclusionRequired = false,
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
    probe.state === MacOSCapabilityStates.VERIFIED &&
    NATIVE_STATES.has(probe.evidence.tunState);

  capabilityRegistry.set(MacOSCapabilities.PACKET_TUNNEL, {
    state: tunVerified ? MacOSCapabilityStates.VERIFIED : MacOSCapabilityStates.FAILED,
    reason: tunVerified ? "tun-state-verified" : (probe.reason || "tun-state-not-verified"),
    evidence: {
      ...probe.evidence,
      capability: MacOSCapabilities.PACKET_TUNNEL,
      tunVerified,
      routeReady: Boolean(routeReady),
      dnsReady: Boolean(dnsReady),
    },
  });

  const processExclusionReady = !processExclusionRequired ||
    capabilityRegistry.canUse(MacOSCapabilities.PROCESS_EXCLUSION, MacOSCapabilityStates.SUPPORTED);

  const ready = tunVerified && Boolean(routeReady) && Boolean(dnsReady) &&
    Boolean(securityHealthy) && processExclusionReady;
  const state = tunVerified
    ? (ready ? PathRegistryStates.ACTIVE : PathRegistryStates.DISABLED)
    : PathRegistryStates.QUARANTINED;

  const result = pathRegistry.register({
    id: pathId.trim(),
    type: "kernel-tunnel",
    platform: "macos",
    state,
    trust: tunVerified ? "verified" : "rejected",
    verified: tunVerified,
    securityHealthy: Boolean(securityHealthy) && tunVerified,
    userAllowed: userAllowed !== false,
    readiness: {
      tun: tunVerified,
      route: Boolean(routeReady),
      dns: Boolean(dnsReady),
      processExclusion: processExclusionReady,
    },
    evidence: {
      ...probe.evidence,
      tunState: probe.evidence.tunState || null,
      processExclusionRequired: Boolean(processExclusionRequired),
    },
  });

  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    capability: capabilityRegistry.get(MacOSCapabilities.PACKET_TUNNEL),
    path: result.path,
    admissible: ready && userAllowed !== false,
  });
}
