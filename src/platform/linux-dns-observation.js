import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_DNS_OBSERVATION_VERSION = 1;
export const LINUX_DNS_DEFAULT_RESOLV_CONF = "/etc/resolv.conf";

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

function normalizeAddress(value) {
  const address = typeof value === "string" ? value.trim() : "";
  if (IPV4.test(address)) return { address, family: "ipv4" };
  if (address.includes(":") && IPV6.test(address)) return { address, family: "ipv6" };
  return null;
}

export function parseLinuxResolvConf(content, { source = LINUX_DNS_DEFAULT_RESOLV_CONF } = {}) {
  if (typeof content !== "string") {
    return Object.freeze({ ok: false, state: LinuxCapabilityStates.FAILED, reason: "resolver-source-invalid" });
  }
  const nameservers = [];
  const invalidNameservers = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line || !line.startsWith("nameserver")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] !== "nameserver" || !parts[1]) {
      invalidNameservers.push(line);
      continue;
    }
    const parsed = normalizeAddress(parts[1]);
    if (parsed) nameservers.push(Object.freeze(parsed));
    else invalidNameservers.push(parts[1]);
  }
  const ipv4 = nameservers.filter(item => item.family === "ipv4").length;
  const ipv6 = nameservers.filter(item => item.family === "ipv6").length;
  const valid = nameservers.length > 0 && invalidNameservers.length === 0;
  return Object.freeze({
    ok: true,
    state: valid ? LinuxCapabilityStates.VERIFIED : LinuxCapabilityStates.FAILED,
    reason: valid ? "resolver-config-observed" : "resolver-config-invalid",
    evidence: Object.freeze({
      source,
      nameserverCount: nameservers.length,
      ipv4NameserverCount: ipv4,
      ipv6NameserverCount: ipv6,
      nameservers: Object.freeze(nameservers),
      invalidNameservers: Object.freeze(invalidNameservers),
    }),
  });
}

export function observeLinuxDns({ readFile = null, path = LINUX_DNS_DEFAULT_RESOLV_CONF } = {}) {
  if (typeof readFile !== "function") {
    return Object.freeze({ ok: false, state: LinuxCapabilityStates.FAILED, reason: "resolver-reader-required" });
  }
  if (typeof path !== "string" || !path.trim()) {
    return Object.freeze({ ok: false, state: LinuxCapabilityStates.FAILED, reason: "resolver-path-invalid" });
  }
  try {
    return parseLinuxResolvConf(readFile(path), { source: path });
  } catch (error) {
    return Object.freeze({
      ok: false,
      state: LinuxCapabilityStates.FAILED,
      reason: "resolver-read-failed",
      evidence: Object.freeze({ source: path, error: String(error?.message || error) }),
    });
  }
}

export function syncLinuxDnsObservation({ capabilityRegistry, observation } = {}) {
  if (!capabilityRegistry || typeof capabilityRegistry.set !== "function") {
    return Object.freeze({ ok: false, reason: "capability-registry-required" });
  }
  const result = observation && typeof observation === "object"
    ? observation
    : { state: LinuxCapabilityStates.FAILED, reason: "dns-observation-missing", evidence: {} };
  const state = Object.values(LinuxCapabilityStates).includes(result.state)
    ? result.state : LinuxCapabilityStates.FAILED;
  const updated = capabilityRegistry.set(LinuxCapabilities.DNS_OBSERVATION, {
    state,
    reason: typeof result.reason === "string" ? result.reason : null,
    evidence: {
      ...(result.evidence && typeof result.evidence === "object" ? result.evidence : {}),
      capability: LinuxCapabilities.DNS_OBSERVATION,
      observationOnly: true,
      trafficPathVerified: false,
    },
  });
  if (!updated.ok) return Object.freeze({ ok: false, reason: "capability-update-failed" });
  return Object.freeze({
    ok: true,
    capability: capabilityRegistry.get(LinuxCapabilities.DNS_OBSERVATION),
    ready: state === LinuxCapabilityStates.VERIFIED,
  });
}

export function evaluateLinuxDnsPathObservation(observation) {
  if (!observation || typeof observation !== "object") {
    return Object.freeze({ ok: false, ready: false, reason: "dns-observation-missing" });
  }
  const evidence = observation.evidence;
  if (observation.state !== LinuxCapabilityStates.VERIFIED ||
      !evidence || evidence.observationOnly !== true ||
      evidence.trafficPathVerified === true) {
    return Object.freeze({ ok: false, ready: false, reason: "dns-path-not-verified" });
  }
  return Object.freeze({
    ok: true,
    ready: false,
    reason: "resolver-config-observed-only",
    securityHealthy: false,
    trafficPathVerified: false,
  });
}
