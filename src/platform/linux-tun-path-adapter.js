import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";
import { LinuxTunStates } from "./linux-tun-probe.js";
import { PathRegistryStates } from "../core/path-registry.js";

export const LINUX_TUN_PATH_ADAPTER_VERSION = 1;

function normalizeProbe(probe) {
  if (!probe || typeof probe !== "object") {
    return {
      state: LinuxCapabilityStates.FAILED,
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
 * Synchronizes Linux TUN probe evidence into the platform path registry.
 *
 * TUN verification is deliberately independent from route, DNS and firewall
 * readiness. A TUN-only result therefore cannot become an admissible path.
 */
export function syncLinuxTunPath({
  capabilityRegistry,
  pathRegistry,
  probeResult,
  pathId = "linux-tun",
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
    probe.state === LinuxCapabilityStates.VERIFIED &&
    [LinuxTunStates.CREATED, LinuxTunStates.UP, LinuxTunStates.RUNNING].includes(probe.evidence.tunState);

  capabilityRegistry.set(LinuxCapabilities.TUN, {
    state: tunVerified ? LinuxCapabilityStates.VERIFIED : LinuxCapabilityStates.FAILED,
    reason: tunVerified ? "tun-state-verified" : (probe.reason || "tun-state-not-verified"),
    evidence: {
      ...probe.evidence,
      capability: LinuxCapabilities.TUN,
      tunVerified,
      routeReady: Boolean(routeReady),
      dnsReady: Boolean(dnsReady),
    },
  });

  const ready = tunVerified && Boolean(routeReady) && Boolean(dnsReady) && Boolean(securityHealthy);
  const state = tunVerified
    ? (ready ? PathRegistryStates.ACTIVE : PathRegistryStates.DISABLED)
    : PathRegistryStates.QUARANTINED;

  const result = pathRegistry.register({
    id: pathId.trim(),
    type: "kernel-tunnel",
    platform: "linux",
    state,
    trust: tunVerified ? "verified" : "rejected",
    verified: tunVerified,
    securityHealthy: Boolean(securityHealthy) && tunVerified,
    userAllowed: userAllowed !== false,
    readiness: {
      tun: tunVerified,
      route: Boolean(routeReady),
      dns: Boolean(dnsReady),
      firewall: Boolean(securityHealthy),
    },
    evidence: {
      ...probe.evidence,
      tunState: probe.evidence.tunState || null,
    },
  });

  if (!result.ok) return result;
  return Object.freeze({
    ok: true,
    capability: capabilityRegistry.get(LinuxCapabilities.TUN),
    path: result.path,
    admissible: ready && userAllowed !== false,
  });
}
