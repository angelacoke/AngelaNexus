import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_NETWORK_CAPABILITY_ADAPTER_VERSION = 1;

const NETWORK_CAPABILITIES = Object.freeze([
  LinuxCapabilities.IPV4,
  LinuxCapabilities.IPV6,
  LinuxCapabilities.POLICY_ROUTE,
  LinuxCapabilities.NFTABLES,
]);

function normalizeState(result) {
  if (!result || typeof result !== "object") {
    return { state: LinuxCapabilityStates.FAILED, reason: "probe-result-missing", evidence: {} };
  }
  const state = result.state;
  const valid = Object.values(LinuxCapabilityStates).includes(state);
  return {
    state: valid ? state : LinuxCapabilityStates.FAILED,
    reason: typeof result.reason === "string" ? result.reason : (valid ? null : "invalid-probe-state"),
    evidence: result.evidence && typeof result.evidence === "object" ? result.evidence : {},
  };
}

export function syncLinuxNetworkCapabilities({
  capabilityRegistry,
  probes = {},
} = {}) {
  if (!capabilityRegistry || typeof capabilityRegistry.set !== "function") {
    return Object.freeze({ ok: false, reason: "capability-registry-required" });
  }

  const results = {};
  for (const capability of NETWORK_CAPABILITIES) {
    const probe = typeof probes[capability] === "function"
      ? probes[capability]()
      : probes[capability];
    const normalized = normalizeState(probe);
    const evidence = {
      ...normalized.evidence,
      capability,
      independentlyProbed: true,
    };
    const setResult = capabilityRegistry.set(capability, {
      state: normalized.state,
      reason: normalized.reason,
      evidence,
    });
    if (!setResult.ok) return Object.freeze({ ok: false, reason: "capability-update-failed", capability });
    results[capability] = capabilityRegistry.get(capability);
  }

  return Object.freeze({
    ok: true,
    capabilities: Object.freeze(results),
  });
}
