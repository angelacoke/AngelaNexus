import { selectTransparentBackend } from "./transparent-backend-capability.js";
import { capabilityTruthFromBackend } from "./capability-truth.js";

export const ANDROID_TRANSPARENT_MODES = Object.freeze({
  AUTO: "auto",
  SYSTEM: "system",
  ROOT: "root",
});

export const ANDROID_TRANSPARENT_CAPABILITIES = Object.freeze([
  "root",
  "root-authorized",
  "tcp",
  "udp",
  "dns",
  "icmp",
  "ipv4",
  "ipv6",
  "uid-identity",
  "process-identity",
  "policy-routing",
  "atomic-rollback",
]);

function has(capabilities, key) {
  return capabilities && capabilities[key] === true;
}

export function inspectAndroidTransparentCapabilities(runtime = {}) {
  const capabilities = {};
  for (const key of ANDROID_TRANSPARENT_CAPABILITIES) capabilities[key] = has(runtime, key);
  capabilities.systemVpn = runtime.systemVpn !== false;
  return Object.freeze(capabilities);
}

export function selectAndroidTransparentMode(requestedMode = ANDROID_TRANSPARENT_MODES.AUTO, capabilities = {}) {
  const requested = Object.values(ANDROID_TRANSPARENT_MODES).includes(requestedMode)
    ? requestedMode
    : ANDROID_TRANSPARENT_MODES.AUTO;
  const rootReady = has(capabilities, "root") && has(capabilities, "root-authorized");
  const rootEvidence = rootReady && ["tcp", "udp", "dns", "ipv4", "ipv6", "uid-identity", "policy-routing", "atomic-rollback"]
    .every((key) => has(capabilities, key));
  const rootSelection = selectTransparentBackend({
    platform: "android",
    requiredCapabilities: ["tcp", "udp", "dns-interception", "ipv4", "ipv6", "uid-identity", "policy-routing", "atomic-rollback"],
    evidence: { "android-root": rootEvidence },
    preferred: ["android-root"],
  });
  const rootComplete = rootSelection.ok && rootSelection.backend.id === "android-root";
  if (requested === ANDROID_TRANSPARENT_MODES.ROOT) {
    return Object.freeze({
      requested,
      selected: rootComplete ? ANDROID_TRANSPARENT_MODES.ROOT : "unavailable",
      failClosed: true,
      reason: rootComplete ? "root-capability-ready" : "root-capability-incomplete",
      backend: rootComplete ? rootSelection.backend : null,
      truth: rootComplete ? capabilityTruthFromBackend(rootSelection.backend, { "android-root": true }) : null,
    });
  }
  if (requested === ANDROID_TRANSPARENT_MODES.SYSTEM) {
    return Object.freeze({
      requested,
      selected: capabilities.systemVpn ? ANDROID_TRANSPARENT_MODES.SYSTEM : "unavailable",
      failClosed: true,
      reason: capabilities.systemVpn ? "system-vpn-available" : "system-vpn-unavailable",
    });
  }
  return Object.freeze({
    requested,
    selected: rootComplete ? ANDROID_TRANSPARENT_MODES.ROOT : (capabilities.systemVpn ? ANDROID_TRANSPARENT_MODES.SYSTEM : "unavailable"),
    failClosed: true,
    reason: rootComplete ? "auto-selected-root" : (capabilities.systemVpn ? "auto-selected-system" : "no-transparent-mode-available"),
    backend: rootComplete ? rootSelection.backend : null,
    truth: rootComplete ? capabilityTruthFromBackend(rootSelection.backend, { "android-root": true }) : null,
  });
}

export function createAndroidRootTransaction(adapter) {
  if (!adapter || typeof adapter.prepare !== "function" || typeof adapter.commit !== "function" || typeof adapter.rollback !== "function") {
    throw new Error("android root adapter requires prepare, commit and rollback");
  }
  let prepared = false;
  let committed = false;
  return Object.freeze({
    prepare() {
      if (prepared || committed) throw new Error("android root transaction is not reusable");
      adapter.prepare();
      prepared = true;
      return "prepared";
    },
    commit() {
      if (!prepared || committed) throw new Error("android root transaction is not prepared");
      try {
        adapter.commit();
        committed = true;
        return "committed";
      } catch (error) {
        try { adapter.rollback(); } finally { prepared = false; }
        throw error;
      }
    },
    rollback() {
      if (!prepared || committed) return "noop";
      adapter.rollback();
      prepared = false;
      return "rolled-back";
    },
  });
}
