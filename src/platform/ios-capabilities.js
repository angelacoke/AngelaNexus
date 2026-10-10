import { PlatformId } from "./contract.js";

/**
 * iOS platform capability model (contract level).
 *
 * Grounding:
 * - PACKET_TUNNEL: the native boundary in
 *   native/apple/AngelaNexusPacketTunnelProvider.swift is an
 *   NEPacketTunnelProvider subclass. It explicitly refuses to install a default
 *   route without an explicit user policy.
 * - docs/PLATFORM_ARCHITECTURE.md: "Apple transparent proxying requires
 *   Network Extension / platform-specific service integration; iOS and macOS
 *   capabilities differ."
 *
 * Platform constraints are documented as constraints, not as probed states:
 * iOS apps run inside the Apple sandbox; there is no root/jailbreak assumption
 * and no privileged transparent proxying outside NetworkExtension. Capability
 * states remain evidence-driven: unknown means unprobed and fails closed.
 * Nothing here claims production readiness on a real device.
 */
export const IOS_CAPABILITY_VERSION = 1;

export const IOSCapabilities = Object.freeze({
  PACKET_TUNNEL: "packet-tunnel",
  APP_PROXY: "app-proxy",
  DNS_OBSERVATION: "dns-observation",
});

export const IOSCapabilityStates = Object.freeze({
  UNKNOWN: "unknown",
  UNSUPPORTED: "unsupported",
  SUPPORTED: "supported",
  VERIFIED: "verified",
  DEGRADED: "degraded",
  FAILED: "failed",
});

export const IOS_PLATFORM_CONSTRAINTS = Object.freeze({
  noRootAssumption: true,
  noPrivilegedTransparentProxyOutsideNetworkExtension: true,
  defaultRouteRequiresExplicitUserPolicy: true,
  perAppVpnRequiresSupervisedDevice: true,
});

const VALID_STATES = new Set(Object.values(IOSCapabilityStates));

function normalizeEvidence(evidence = {}) {
  return Object.freeze({
    ...evidence,
    checkedAt: Number.isFinite(evidence.checkedAt) ? evidence.checkedAt : null,
    source: typeof evidence.source === "string" ? evidence.source : "runtime-probe",
  });
}

function normalizeEntry(capability, entry) {
  const state = entry?.state;
  if (!Object.values(IOSCapabilities).includes(capability)) {
    throw new TypeError("unsupported iOS capability: " + capability);
  }
  if (!VALID_STATES.has(state)) throw new TypeError("invalid iOS capability state: " + state);
  return Object.freeze({
    capability,
    state,
    evidence: normalizeEvidence(entry.evidence),
    reason: typeof entry.reason === "string" ? entry.reason : null,
  });
}

export function createIOSCapabilityRegistry({ initial = {} } = {}) {
  const entries = new Map();

  for (const [capability, entry] of Object.entries(initial)) {
    entries.set(capability, normalizeEntry(capability, entry));
  }

  function set(capability, entry) {
    const normalized = normalizeEntry(capability, entry);
    entries.set(capability, normalized);
    return Object.freeze({ ok: true, entry: normalized });
  }

  function get(capability) {
    return entries.get(capability) || Object.freeze({
      capability,
      state: IOSCapabilityStates.UNKNOWN,
      evidence: Object.freeze({ source: "unprobed" }),
      reason: "capability-not-probed",
    });
  }

  function canUse(capability, minimum = IOSCapabilityStates.VERIFIED) {
    const entry = get(capability);
    const accepted = new Set([
      IOSCapabilityStates.SUPPORTED,
      IOSCapabilityStates.VERIFIED,
      IOSCapabilityStates.DEGRADED,
    ]);
    if (minimum === IOSCapabilityStates.VERIFIED) {
      return entry.state === IOSCapabilityStates.VERIFIED;
    }
    if (minimum === IOSCapabilityStates.SUPPORTED) {
      return accepted.has(entry.state);
    }
    return entry.state === minimum;
  }

  function snapshot() {
    return Object.freeze({
      version: IOS_CAPABILITY_VERSION,
      platform: PlatformId.IOS,
      capabilities: Object.freeze([...entries.values()]),
    });
  }

  return Object.freeze({ version: IOS_CAPABILITY_VERSION, set, get, canUse, snapshot });
}
