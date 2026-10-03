import { spawnSync } from "node:child_process";
import { LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_NATIVE_DNS_PROBE_RUNTIME_VERSION = 1;

const OUTPUT_PATTERN = /^dns-udp-state=(-1|0|1) dns-udp-packets=([0-9]+)\s*$/;

function parseOutput(stdout) {
  if (typeof stdout !== "string") {
    return { ok: false, state: LinuxCapabilityStates.FAILED, reason: "dns-probe-output-invalid" };
  }
  const match = OUTPUT_PATTERN.exec(stdout.trim());
  if (!match) {
    return { ok: false, state: LinuxCapabilityStates.FAILED, reason: "dns-probe-output-malformed" };
  }
  const rawState = Number(match[1]);
  const packetCount = Number(match[2]);
  if (!Number.isSafeInteger(packetCount)) {
    return { ok: false, state: LinuxCapabilityStates.FAILED, reason: "dns-probe-packet-count-invalid" };
  }
  const state = rawState === 1
    ? LinuxCapabilityStates.VERIFIED
    : rawState === 0
      ? LinuxCapabilityStates.UNSUPPORTED
      : LinuxCapabilityStates.FAILED;
  return {
    ok: state !== LinuxCapabilityStates.FAILED,
    state,
    reason: rawState === 1 ? "dns-udp-traffic-observed" : rawState === 0 ? "dns-udp-traffic-not-observed" : "dns-probe-failed",
    evidence: {
      source: "native-linux-dns-traffic-probe-command",
      rawState,
      packetCount,
      observationOnly: true,
      trafficPathVerified: rawState === 1 && packetCount > 0,
      transport: "udp",
      port: 53,
    },
  };
}

export function createLinuxNativeDnsTrafficProbe({
  commandPath,
  spawnSyncImpl = spawnSync,
  timeoutMs = 1500,
  observationTimeoutMs = 1000,
} = {}) {
  if (typeof commandPath !== "string" || !commandPath.trim()) {
    throw new TypeError("Linux DNS probe commandPath is required");
  }
  if (typeof spawnSyncImpl !== "function") {
    throw new TypeError("spawnSyncImpl must be a function");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) {
    throw new RangeError("timeoutMs must be between 1 and 10000");
  }
  if (!Number.isInteger(observationTimeoutMs) || observationTimeoutMs <= 0 || observationTimeoutMs > 10000) {
    throw new RangeError("observationTimeoutMs must be between 1 and 10000");
  }

  let cached = null;
  return Object.freeze({
    probe() {
      if (cached) return cached;
      try {
        const result = spawnSyncImpl(commandPath, [String(observationTimeoutMs)], {
          encoding: "utf8",
          timeout: timeoutMs,
          windowsHide: true,
        });
        if (!result || result.error || result.signal || result.status !== 0) {
          cached = Object.freeze({
            ok: false,
            state: LinuxCapabilityStates.FAILED,
            reason: result?.signal === "SIGTERM" ? "dns-probe-timeout" : "dns-probe-command-failed",
            evidence: {
              source: "native-linux-dns-traffic-probe-command",
              signal: result?.signal || null,
              status: result?.status ?? null,
              error: result?.error ? String(result.error.message || result.error) : null,
            },
          });
          return cached;
        }
        cached = Object.freeze(parseOutput(result.stdout));
        return cached;
      } catch (error) {
        cached = Object.freeze({
          ok: false,
          state: LinuxCapabilityStates.FAILED,
          reason: "dns-probe-command-error",
          evidence: {
            source: "native-linux-dns-traffic-probe-command",
            error: String(error?.message || error),
          },
        });
        return cached;
      }
    },
  });
}
