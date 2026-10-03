import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";
import { LinuxTunStates } from "./linux-tun-probe.js";
import { PathRegistryStates } from "../core/path-registry.js";
import { evaluateLinuxRouteIntent } from "./linux-route-intent.js";

export const LINUX_TUN_PATH_ADAPTER_VERSION = 2;


export function deriveLinuxNetworkEvidence(capabilityRegistry) {
  if (!capabilityRegistry || typeof capabilityRegistry.get !== "function") {
    return Object.freeze({});
  }
  const policy = capabilityRegistry.get(LinuxCapabilities.POLICY_ROUTE);
  const nftables = capabilityRegistry.get(LinuxCapabilities.NFTABLES);
  return Object.freeze({
    policyRouting: Object.freeze({
      state: policy?.state || LinuxCapabilityStates.FAILED,
      ruleCount: Number.isInteger(policy?.evidence?.policyRuleCount)
        ? policy.evidence.policyRuleCount
        : null,
      ipv4RouteCount: Number.isInteger(policy?.evidence?.ipv4RouteCount)
        ? policy.evidence.ipv4RouteCount
        : null,
      ipv6RouteCount: Number.isInteger(policy?.evidence?.ipv6RouteCount)
        ? policy.evidence.ipv6RouteCount
        : null,
      ipv4DefaultRouteCount: Number.isInteger(policy?.evidence?.ipv4DefaultRouteCount)
        ? policy.evidence.ipv4DefaultRouteCount
        : null,
      ipv6DefaultRouteCount: Number.isInteger(policy?.evidence?.ipv6DefaultRouteCount)
        ? policy.evidence.ipv6DefaultRouteCount
        : null,
      ipv4RouteState: policy?.evidence?.ipv4RouteState || LinuxCapabilityStates.FAILED,
      ipv6RouteState: policy?.evidence?.ipv6RouteState || LinuxCapabilityStates.FAILED,
    }),
    nftables: Object.freeze({
      state: nftables?.state || LinuxCapabilityStates.FAILED,
      tableCount: Number.isInteger(nftables?.evidence?.nftTableCount)
        ? nftables.evidence.nftTableCount
        : null,
      chainCount: Number.isInteger(nftables?.evidence?.nftChainCount)
        ? nftables.evidence.nftChainCount
        : null,
    }),
  });
}

function deriveNetworkReadiness(networkEvidence) {
  const evidence = networkEvidence && typeof networkEvidence === "object" ? networkEvidence : {};
  const policy = evidence.policyRouting && typeof evidence.policyRouting === "object" ? evidence.policyRouting : {};
  const firewall = evidence.nftables && typeof evidence.nftables === "object" ? evidence.nftables : {};
  const policyState = policy.state;
  const firewallState = firewall.state;
  return Object.freeze({
    routeReady: policyState === LinuxCapabilityStates.VERIFIED &&
      Number.isInteger(policy.ruleCount) && policy.ruleCount > 0,
    firewallReady: firewallState === LinuxCapabilityStates.VERIFIED &&
      Number.isInteger(firewall.tableCount) && firewall.tableCount > 0 &&
      Number.isInteger(firewall.chainCount) && firewall.chainCount > 0,
    policyRuleCount: Number.isInteger(policy.ruleCount) ? policy.ruleCount : null,
    ipv4RouteCount: Number.isInteger(policy.ipv4RouteCount) ? policy.ipv4RouteCount : null,
    ipv6RouteCount: Number.isInteger(policy.ipv6RouteCount) ? policy.ipv6RouteCount : null,
    ipv4DefaultRouteCount: Number.isInteger(policy.ipv4DefaultRouteCount) ? policy.ipv4DefaultRouteCount : null,
    ipv6DefaultRouteCount: Number.isInteger(policy.ipv6DefaultRouteCount) ? policy.ipv6DefaultRouteCount : null,
    ipv4DefaultRouteReady: Number.isInteger(policy.ipv4DefaultRouteCount) && policy.ipv4DefaultRouteCount > 0,
    ipv6DefaultRouteReady: Number.isInteger(policy.ipv6DefaultRouteCount) && policy.ipv6DefaultRouteCount > 0,
    ipv4RouteReady: policy.ipv4RouteState === LinuxCapabilityStates.VERIFIED &&
      Number.isInteger(policy.ipv4RouteCount) && policy.ipv4RouteCount > 0,
    ipv6RouteReady: policy.ipv6RouteState === LinuxCapabilityStates.VERIFIED &&
      Number.isInteger(policy.ipv6RouteCount) && policy.ipv6RouteCount > 0,
    nftTableCount: Number.isInteger(firewall.tableCount) ? firewall.tableCount : null,
    nftChainCount: Number.isInteger(firewall.chainCount) ? firewall.chainCount : null,
  });
}

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
 * Route counts and default-route observations are evidence only; they do not
 * prove an intent-specific effective route. TUN verification is deliberately independent from route, DNS and firewall
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
  networkEvidence = null,
  routeIntent = null,
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
  const network = deriveNetworkReadiness(networkEvidence);
  const routeIntentEvaluation = routeIntent && typeof routeIntent === "object"
    ? evaluateLinuxRouteIntent(routeIntent.intent, routeIntent.evidence)
    : null;
  const effectiveRouteReady = routeIntentEvaluation
    ? routeIntentEvaluation.ready
    : (Boolean(routeReady) || network.routeReady);
  const effectiveFirewallReady = networkEvidence && typeof networkEvidence === "object"
    ? Boolean(network.firewallReady)
    : Boolean(securityHealthy);
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
      routeReady: effectiveRouteReady,
      dnsReady: Boolean(dnsReady),
    },
  });

  const ready = tunVerified && effectiveRouteReady && Boolean(dnsReady) &&
    effectiveFirewallReady && Boolean(securityHealthy);
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
      route: effectiveRouteReady,
      dns: Boolean(dnsReady),
      firewall: effectiveFirewallReady,
    },
    evidence: {
      ...probe.evidence,
      tunState: probe.evidence.tunState || null,
      networkState: network,
      firewallReady: effectiveFirewallReady,
      routeIntent: routeIntentEvaluation,
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
