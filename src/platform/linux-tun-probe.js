import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_TUN_PROBE_VERSION = 1;

export const LinuxTunStates = Object.freeze({
  CREATED: "created",
  UP: "up",
  RUNNING: "running",
});

const NATIVE_STATES = new Set(Object.values(LinuxTunStates));

function evidence(base, state) {
  return Object.freeze({
    ...base,
    source: typeof base?.source === "string" ? base.source : "linux-tun-native-probe",
    checkedAt: Number.isFinite(base?.checkedAt) ? base.checkedAt : Date.now(),
    tunState: state,
  });
}

/**
 * Convert the native TUN boundary result into platform capability truth.
 *
 * A successful kernel state query is required before the TUN capability can be
 * marked verified. Interface state is kept as evidence and is not conflated
 * with routing/DNS/firewall readiness.
 */
export function evaluateLinuxTunProbe(result = {}) {
  const state = result?.state;
  const base = result?.evidence || {};

  if (!NATIVE_STATES.has(state)) {
    return Object.freeze({
      capability: LinuxCapabilities.TUN,
      state: LinuxCapabilityStates.FAILED,
      evidence: evidence(base, null),
      reason: "tun-state-probe-failed",
    });
  }

  return Object.freeze({
    capability: LinuxCapabilities.TUN,
    state: LinuxCapabilityStates.VERIFIED,
    evidence: evidence(base, state),
    reason: "tun-interface-state-verified",
  });
}

export function probeLinuxTunCapability({ openTun, probeTunState, closeTun } = {}) {
  if (typeof openTun !== "function" || typeof probeTunState !== "function") {
    throw new TypeError("openTun and probeTunState functions are required");
  }

  let handle;
  try {
    handle = openTun();
    if (handle === null || handle === undefined || handle === -1) {
      return evaluateLinuxTunProbe({
        state: null,
        evidence: { source: "linux-tun-native-open", open: false },
      });
    }

    const result = probeTunState(handle);
    return evaluateLinuxTunProbe({
      ...result,
      evidence: {
        ...(result?.evidence || {}),
        open: true,
      },
    });
  } catch (error) {
    return Object.freeze({
      capability: LinuxCapabilities.TUN,
      state: LinuxCapabilityStates.FAILED,
      evidence: evidence({
        source: "linux-tun-native-probe",
        error: error instanceof Error ? error.message : String(error),
      }, null),
      reason: "tun-native-probe-error",
    });
  } finally {
    if (typeof closeTun === "function" && handle !== undefined && handle !== null && handle !== -1) {
      closeTun(handle);
    }
  }
}
