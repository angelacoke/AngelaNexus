import { PlatformId } from "./contract.js";

export const LINUX_CAPABILITY_VERSION = 1;

export const LinuxCapabilities = Object.freeze({
  TUN: "tun",
  IPV4: "ipv4",
  IPV6: "ipv6",
  POLICY_ROUTE: "policy-route",
  NFTABLES: "nftables",
  EBPF: "ebpf",
  EBPF_SOCKET: "ebpf-socket",
  TC: "tc",
  XDP: "xdp",
  AF_XDP: "af-xdp",
  WIREGUARD: "wireguard",
  NET_ADMIN: "net-admin",
  DNS_OBSERVATION: "dns-observation",
});

export const LinuxCapabilityStates = Object.freeze({
  UNKNOWN: "unknown",
  UNSUPPORTED: "unsupported",
  SUPPORTED: "supported",
  VERIFIED: "verified",
  DEGRADED: "degraded",
  FAILED: "failed",
});

const VALID_STATES = new Set(Object.values(LinuxCapabilityStates));

function normalizeEvidence(evidence = {}) {
  return Object.freeze({
    ...evidence,
    checkedAt: Number.isFinite(evidence.checkedAt) ? evidence.checkedAt : null,
    source: typeof evidence.source === "string" ? evidence.source : "runtime-probe",
  });
}

function normalizeEntry(capability, entry) {
  const state = entry?.state;
  if (!Object.values(LinuxCapabilities).includes(capability)) {
    throw new TypeError("unsupported Linux capability: " + capability);
  }
  if (!VALID_STATES.has(state)) throw new TypeError("invalid Linux capability state: " + state);
  return Object.freeze({
    capability,
    state,
    evidence: normalizeEvidence(entry.evidence),
    reason: typeof entry.reason === "string" ? entry.reason : null,
  });
}

export function createLinuxCapabilityRegistry({ initial = {} } = {}) {
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
      state: LinuxCapabilityStates.UNKNOWN,
      evidence: Object.freeze({ source: "unprobed" }),
      reason: "capability-not-probed",
    });
  }

  function canUse(capability, minimum = LinuxCapabilityStates.VERIFIED) {
    const entry = get(capability);
    const accepted = new Set([
      LinuxCapabilityStates.SUPPORTED,
      LinuxCapabilityStates.VERIFIED,
      LinuxCapabilityStates.DEGRADED,
    ]);
    if (minimum === LinuxCapabilityStates.VERIFIED) {
      return entry.state === LinuxCapabilityStates.VERIFIED;
    }
    if (minimum === LinuxCapabilityStates.SUPPORTED) {
      return accepted.has(entry.state);
    }
    return entry.state === minimum;
  }

  function snapshot() {
    return Object.freeze({
      version: LINUX_CAPABILITY_VERSION,
      platform: PlatformId.LINUX,
      capabilities: Object.freeze([...entries.values()]),
    });
  }

  return Object.freeze({ version: LINUX_CAPABILITY_VERSION, set, get, canUse, snapshot });
}
