import { PlatformId } from "./contract.js";

/**
 * Windows platform capability model (contract level).
 *
 * Grounding:
 * - WINTUN_TUN: the native boundary in native/windows/AngelaNexusTun.cpp loads
 *   the wintun driver DLL (LoadLibraryW). TUN availability therefore depends on
 *   the wintun driver being installed and loadable.
 * - WFP / ELEVATED_INSTALL: docs/PLATFORM_ARCHITECTURE.md states that Windows
 *   transparent proxying "can require WFP/TUN integration and elevated
 *   installation/service capabilities".
 *
 * Capability states are evidence-driven. Unknown means unprobed and fails
 * closed; nothing here claims production readiness on a real device.
 */
export const WINDOWS_CAPABILITY_VERSION = 1;

export const WindowsCapabilities = Object.freeze({
  WINTUN_TUN: "wintun-tun",
  WFP: "wfp",
  ELEVATED_INSTALL: "elevated-install",
  SYSTEM_PROXY: "system-proxy",
  PROCESS_EXCLUSION: "process-exclusion",
  DNS_OBSERVATION: "dns-observation",
});

export const WindowsCapabilityStates = Object.freeze({
  UNKNOWN: "unknown",
  UNSUPPORTED: "unsupported",
  SUPPORTED: "supported",
  VERIFIED: "verified",
  DEGRADED: "degraded",
  FAILED: "failed",
});

const VALID_STATES = new Set(Object.values(WindowsCapabilityStates));

function normalizeEvidence(evidence = {}) {
  return Object.freeze({
    ...evidence,
    checkedAt: Number.isFinite(evidence.checkedAt) ? evidence.checkedAt : null,
    source: typeof evidence.source === "string" ? evidence.source : "runtime-probe",
  });
}

function normalizeEntry(capability, entry) {
  const state = entry?.state;
  if (!Object.values(WindowsCapabilities).includes(capability)) {
    throw new TypeError("unsupported Windows capability: " + capability);
  }
  if (!VALID_STATES.has(state)) throw new TypeError("invalid Windows capability state: " + state);
  return Object.freeze({
    capability,
    state,
    evidence: normalizeEvidence(entry.evidence),
    reason: typeof entry.reason === "string" ? entry.reason : null,
  });
}

export function createWindowsCapabilityRegistry({ initial = {} } = {}) {
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
      state: WindowsCapabilityStates.UNKNOWN,
      evidence: Object.freeze({ source: "unprobed" }),
      reason: "capability-not-probed",
    });
  }

  function canUse(capability, minimum = WindowsCapabilityStates.VERIFIED) {
    const entry = get(capability);
    const accepted = new Set([
      WindowsCapabilityStates.SUPPORTED,
      WindowsCapabilityStates.VERIFIED,
      WindowsCapabilityStates.DEGRADED,
    ]);
    if (minimum === WindowsCapabilityStates.VERIFIED) {
      return entry.state === WindowsCapabilityStates.VERIFIED;
    }
    if (minimum === WindowsCapabilityStates.SUPPORTED) {
      return accepted.has(entry.state);
    }
    return entry.state === minimum;
  }

  function snapshot() {
    return Object.freeze({
      version: WINDOWS_CAPABILITY_VERSION,
      platform: PlatformId.WINDOWS,
      capabilities: Object.freeze([...entries.values()]),
    });
  }

  return Object.freeze({ version: WINDOWS_CAPABILITY_VERSION, set, get, canUse, snapshot });
}
