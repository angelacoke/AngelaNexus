import { PlatformId } from "./contract.js";

/**
 * macOS platform capability model (contract level).
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
 * Capability states are evidence-driven. Unknown means unprobed and fails
 * closed; nothing here claims production readiness on a real device.
 */
export const MACOS_CAPABILITY_VERSION = 1;

export const MacOSCapabilities = Object.freeze({
  PACKET_TUNNEL: "packet-tunnel",
  SYSTEM_EXTENSION: "system-extension",
  APP_PROXY: "app-proxy",
  PF_TRANSPARENT: "pf-transparent",
  ELEVATED: "elevated",
  PROCESS_EXCLUSION: "process-exclusion",
  DNS_OBSERVATION: "dns-observation",
});

export const MacOSCapabilityStates = Object.freeze({
  UNKNOWN: "unknown",
  UNSUPPORTED: "unsupported",
  SUPPORTED: "supported",
  VERIFIED: "verified",
  DEGRADED: "degraded",
  FAILED: "failed",
});

const VALID_STATES = new Set(Object.values(MacOSCapabilityStates));

function normalizeEvidence(evidence = {}) {
  return Object.freeze({
    ...evidence,
    checkedAt: Number.isFinite(evidence.checkedAt) ? evidence.checkedAt : null,
    source: typeof evidence.source === "string" ? evidence.source : "runtime-probe",
  });
}

function normalizeEntry(capability, entry) {
  const state = entry?.state;
  if (!Object.values(MacOSCapabilities).includes(capability)) {
    throw new TypeError("unsupported macOS capability: " + capability);
  }
  if (!VALID_STATES.has(state)) throw new TypeError("invalid macOS capability state: " + state);
  return Object.freeze({
    capability,
    state,
    evidence: normalizeEvidence(entry.evidence),
    reason: typeof entry.reason === "string" ? entry.reason : null,
  });
}

export function createMacOSCapabilityRegistry({ initial = {} } = {}) {
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
      state: MacOSCapabilityStates.UNKNOWN,
      evidence: Object.freeze({ source: "unprobed" }),
      reason: "capability-not-probed",
    });
  }

  function canUse(capability, minimum = MacOSCapabilityStates.VERIFIED) {
    const entry = get(capability);
    const accepted = new Set([
      MacOSCapabilityStates.SUPPORTED,
      MacOSCapabilityStates.VERIFIED,
      MacOSCapabilityStates.DEGRADED,
    ]);
    if (minimum === MacOSCapabilityStates.VERIFIED) {
      return entry.state === MacOSCapabilityStates.VERIFIED;
    }
    if (minimum === MacOSCapabilityStates.SUPPORTED) {
      return accepted.has(entry.state);
    }
    return entry.state === minimum;
  }

  function snapshot() {
    return Object.freeze({
      version: MACOS_CAPABILITY_VERSION,
      platform: PlatformId.MACOS,
      capabilities: Object.freeze([...entries.values()]),
    });
  }

  return Object.freeze({ version: MACOS_CAPABILITY_VERSION, set, get, canUse, snapshot });
}
