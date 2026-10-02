export const TRANSPARENT_BACKEND_CAPABILITY_VERSION = 1;

export const TransparentBackendIds = Object.freeze({
  ANDROID_VPN: "android-vpn",
  ANDROID_ROOT: "android-root",
  LINUX_TUN: "linux-tun",
  LINUX_TPROXY: "linux-tproxy",
  LINUX_EBPF_SOCKET: "linux-ebpf-socket",
  MACOS_TUN: "macos-tun",
  MACOS_NETWORK_EXTENSION: "macos-network-extension",
  WINDOWS_TUN: "windows-tun",
  WINDOWS_WFP: "windows-wfp",
  IOS_PACKET_TUNNEL: "ios-packet-tunnel",
});

export const TransparentBackendCapabilities = Object.freeze([
  "packet-capture",
  "socket-capture",
  "tcp",
  "udp",
  "ipv4",
  "ipv6",
  "original-destination",
  "process-identity",
  "uid-identity",
  "hostname-evidence",
  "dns-interception",
  "policy-routing",
  "atomic-rollback",
  "lifecycle-recovery",
]);

const MATRIX = Object.freeze({
  [TransparentBackendIds.ANDROID_VPN]: {
    platform: "android",
    maturity: "supported",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "dns-interception", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "VpnService packet interception; process identity is not assumed.",
  },
  [TransparentBackendIds.ANDROID_ROOT]: {
    platform: "android",
    maturity: "capability-gated",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "uid-identity", "dns-interception", "policy-routing", "atomic-rollback", "lifecycle-recovery"],
    evidence: "runtime-probe",
    notes: "Requires verified runtime evidence; process identity remains optional.",
  },
  [TransparentBackendIds.LINUX_TUN]: {
    platform: "linux",
    maturity: "supported",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "Packet-layer capture; original destination/process identity depend on additional platform evidence.",
  },
  [TransparentBackendIds.LINUX_TPROXY]: {
    platform: "linux",
    maturity: "capability-gated",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "original-destination", "policy-routing", "atomic-rollback", "lifecycle-recovery"],
    evidence: "runtime-probe",
    notes: "Requires policy-routing and interception evidence; do not infer process identity.",
  },
  [TransparentBackendIds.LINUX_EBPF_SOCKET]: {
    platform: "linux",
    maturity: "capability-gated",
    capabilities: ["socket-capture", "tcp", "udp", "ipv4", "ipv6", "original-destination", "process-identity", "uid-identity", "lifecycle-recovery"],
    evidence: "runtime-probe",
    notes: "Socket-layer capture can preserve application attribution when kernel evidence is available.",
  },
  [TransparentBackendIds.MACOS_TUN]: {
    platform: "macos",
    maturity: "supported",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "Packet-layer fallback when socket-level interception is unavailable.",
  },
  [TransparentBackendIds.MACOS_NETWORK_EXTENSION]: {
    platform: "macos",
    maturity: "capability-gated",
    capabilities: ["socket-capture", "tcp", "udp", "ipv4", "ipv6", "original-destination", "process-identity", "hostname-evidence", "dns-interception", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "Requires an approved Network Extension implementation and runtime evidence.",
  },
  [TransparentBackendIds.WINDOWS_TUN]: {
    platform: "windows",
    maturity: "supported",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "Packet-layer fallback.",
  },
  [TransparentBackendIds.WINDOWS_WFP]: {
    platform: "windows",
    maturity: "capability-gated",
    capabilities: ["socket-capture", "tcp", "udp", "ipv4", "ipv6", "original-destination", "process-identity", "lifecycle-recovery"],
    evidence: "runtime-probe",
    notes: "Only selectable after a verified WFP implementation is installed and operational.",
  },
  [TransparentBackendIds.IOS_PACKET_TUNNEL]: {
    platform: "ios",
    maturity: "capability-gated",
    capabilities: ["packet-capture", "tcp", "udp", "ipv4", "ipv6", "dns-interception", "lifecycle-recovery"],
    evidence: "platform-api",
    notes: "Packet tunnel path; socket-level capture is not assumed.",
  },
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function listTransparentBackends() {
  return Object.freeze(Object.entries(MATRIX).map(([id, value]) => Object.freeze({
    id,
    platform: value.platform,
    maturity: value.maturity,
    capabilities: Object.freeze([...value.capabilities]),
    evidence: value.evidence,
    notes: value.notes,
  })));
}

export function getTransparentBackendCapability(id) {
  const value = MATRIX[id];
  if (!value) throw new Error("unsupported transparent backend: " + id);
  return Object.freeze({ id, ...clone(value), capabilities: Object.freeze([...value.capabilities]) });
}

export function missingTransparentBackendCapabilities(id, required = []) {
  const backend = getTransparentBackendCapability(id);
  const available = new Set(backend.capabilities);
  return [...new Set(required.filter((item) => typeof item === "string" && item.trim()))]
    .filter((item) => !available.has(item));
}

export function selectTransparentBackend({
  platform,
  requiredCapabilities = [],
  evidence = {},
  preferred = [],
} = {}) {
  const candidates = listTransparentBackends()
    .filter((item) => item.platform === platform)
    .filter((item) => missingTransparentBackendCapabilities(item.id, requiredCapabilities).length === 0)
    .filter((item) => item.maturity === "supported" || evidence[item.id] === true);

  for (const id of preferred) {
    const selected = candidates.find((item) => item.id === id);
    if (selected) return Object.freeze({ ok: true, backend: selected, reason: "preferred-capability-match" });
  }

  const selected = candidates[0] || null;
  return Object.freeze({
    ok: Boolean(selected),
    backend: selected,
    reason: selected ? "capability-match" : "no-verified-backend",
  });
}
