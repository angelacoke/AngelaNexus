import { WindowsCapabilities, WindowsCapabilityStates } from "./windows-capabilities.js";
import { PathRegistryStates } from "../core/path-registry.js";

export const WINDOWS_TUN_PATH_ADAPTER_VERSION = 1;

export const WindowsTunStates = Object.freeze({
  CREATED: "created",
  UP: "up",
  RUNNING: "running",
});

const NATIVE_STATES = new Set(Object.values(WindowsTunStates));

function normalizeProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return {
      state: WindowsCapabilityStates.FAILED,
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
 * Synchronizes Windows wintun TUN probe evidence into the platform path registry.
 *
 * Fail-closed rules:
 * - an unverified or missing TUN probe quarantines the path;
 * - when the caller requires elevation (wintun driver installation needs it),
 *   unevidenced elevation blocks admission;
 * - when the caller requires process exclusion, an unevidenced process-exclusion
 *   capability blocks admission instead of silently widening scope;
 * - explicit user denial always blocks admission.
 *
 * Probe evidence is evidence only; it does not claim production readiness.
 */
export function syncWindowsTunPath({
  capabilityRegistry,
  pathRegistry,
  probeResult,
  pathId = "windows-tun",
  routeReady = false,
  dnsReady = false,
  securityHealthy = false,
  userAllowed = true,
  elevationRequired = false,
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
    probe.state === WindowsCapabilityStates.VERIFIED &&
    NATIVE_STATES.has(probe.evidence.tunState);

  capabilityRegistry.set(WindowsCapabilities.WINTUN_TUN, {
    state: tunVerified ? WindowsCapabilityStates.VERIFIED : WindowsCapabilityStates.FAILED,
    reason: tunVerified ? "tun-state-verified" : (probe.reason || "tun-state-not-verified"),
    evidence: {
      ...probe.evidence,
      capability: WindowsCapabilities.WINTUN_TUN,
      tunVerified,
      routeReady: Boolean(routeReady),
      dnsReady: Boolean(dnsReady),
    },
  });

  const elevationReady = !elevationRequired ||
    capabilityRegistry.canUse(WindowsCapabilities.ELEVATED_INSTALL, WindowsCapabilityStates.SUPPORTED);
  const processExclusionReady = !processExclusionRequired ||
    capabilityRegistry.canUse(WindowsCapabilities.PROCESS_EXCLUSION, WindowsCapabilityStates.SUPPORTED);

  const ready = tunVerified && Boolean(routeReady) && Boolean(dnsReady) &&
    Boolean(securityHealthy) && elevationReady && processExclusionReady;
  const state = tunVerified
    ? (ready ? PathRegistryStates.ACTIVE : PathRegistryStates.DISABLED)
    : PathRegistryStates.QUARANTINED;

  const result = pathRegistry.register({
    id: pathId.trim(),
    type: "kernel-tunnel",
    platform: "windows",
    state,
    trust: tunVerified ? "verified" : "rejected",
    verified: tunVerified,
    securityHealthy: Boolean(securityHealthy) && tunVerified,
    userAllowed: userAllowed !== false,
    readiness: {
      tun: tunVerified,
      route: Boolean(routeReady),
      dns: Boolean(dnsReady),
      elevation: elevationReady,
      processExclusion: processExclusionReady,
    },
    evidence: {
      ...probe.evidence,
      tunState: probe.evidence.tunState || null,
      elevationRequired: Boolean(elevationRequired),
      processExclusionRequired: Boolean(processExclusionRequired),
    },
  });

  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    capability: capabilityRegistry.get(WindowsCapabilities.WINTUN_TUN),
    path: result.path,
    admissible: ready && userAllowed !== false,
  });
}
