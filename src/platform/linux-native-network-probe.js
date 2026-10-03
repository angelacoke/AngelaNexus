import { spawnSync } from "node:child_process";
import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_NATIVE_NETWORK_PROBE_RUNTIME_VERSION = 4;

const CAPABILITY_BINDINGS = Object.freeze([
  [LinuxCapabilities.IPV4, "ipv4"],
  [LinuxCapabilities.IPV6, "ipv6"],
  [LinuxCapabilities.POLICY_ROUTE, "policy-route"],
  [LinuxCapabilities.NFTABLES, "nftables"],
]);

const RESULT_PATTERN = /^ipv4=(-1|0|1) ipv6=(-1|0|1) policy-route=(-1|0|1) nftables=(-1|0|1) policy-rules=([0-9]+) ipv4-routes=([0-9]+) ipv6-routes=([0-9]+) ipv4-route-state=(-1|0|1) ipv6-route-state=(-1|0|1) nft-tables=([0-9]+) nft-chains=([0-9]+)\s*$/;

function failedProbe(reason, evidence = {}) {
  return Object.freeze({
    state: LinuxCapabilityStates.FAILED,
    reason,
    evidence: Object.freeze({
      source: "native-linux-network-probe-command",
      ...evidence,
    }),
  });
}

function mapRawResult(rawResult) {
  if (rawResult === -1) return LinuxCapabilityStates.FAILED;
  if (rawResult === 0) return LinuxCapabilityStates.UNSUPPORTED;
  if (rawResult === 1) return LinuxCapabilityStates.VERIFIED;
  return LinuxCapabilityStates.FAILED;
}

function parseOutput(stdout) {
  const match = RESULT_PATTERN.exec(stdout.trim());
  if (!match) return null;

  return Object.freeze(
    CAPABILITY_BINDINGS.reduce((result, [capability], index) => {
      const rawResult = Number(match[index + 1]);
      const evidence = {
        source: "native-linux-network-probe-command",
        rawResult,
      };
      if (capability === LinuxCapabilities.POLICY_ROUTE) {
        evidence.policyRuleCount = Number(match[5]);
        evidence.ipv4RouteCount = Number(match[6]);
        evidence.ipv6RouteCount = Number(match[7]);
        evidence.ipv4RouteState = mapRawResult(Number(match[8]));
        evidence.ipv6RouteState = mapRawResult(Number(match[9]));
      }
      if (capability === LinuxCapabilities.NFTABLES) {
        evidence.nftTableCount = Number(match[10]);
        evidence.nftChainCount = Number(match[11]);
      }
      result[capability] = Object.freeze({
        state: mapRawResult(rawResult),
        reason: "native-probe-result",
        evidence: Object.freeze(evidence),
      });
      return result;
    }, {}),
  );
}

export function createLinuxNativeNetworkCommandProbes({
  commandPath,
  spawnSyncImpl = spawnSync,
  timeoutMs = 1500,
} = {}) {
  if (typeof commandPath !== "string" || commandPath.length === 0) {
    throw new TypeError("native Linux network probe command path is required");
  }
  if (typeof spawnSyncImpl !== "function") {
    throw new TypeError("spawnSync implementation is required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new RangeError("native probe timeout must be between 1 and 10000 ms");
  }

  let snapshot;
  let executed = false;

  function execute() {
    if (executed) return snapshot;
    executed = true;

    let result;
    try {
      result = spawnSyncImpl(commandPath, [], {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      snapshot = Object.freeze(
        Object.fromEntries(CAPABILITY_BINDINGS.map(([capability]) => [
          capability,
          failedProbe("native-probe-exception", { error: String(error?.message || error) }),
        ])),
      );
      return snapshot;
    }

    if (result?.error) {
      snapshot = Object.freeze(
        Object.fromEntries(CAPABILITY_BINDINGS.map(([capability]) => [
          capability,
          failedProbe(result.signal === "SIGTERM" ? "native-probe-timeout" : "native-probe-error", {
            error: String(result.error?.message || result.error),
            signal: result.signal || null,
          }),
        ])),
      );
      return snapshot;
    }

    if (result?.status !== 0) {
      snapshot = Object.freeze(
        Object.fromEntries(CAPABILITY_BINDINGS.map(([capability]) => [
          capability,
          failedProbe("native-probe-nonzero-exit", {
            status: result?.status ?? null,
            signal: result?.signal || null,
          }),
        ])),
      );
      return snapshot;
    }

    const parsed = parseOutput(typeof result.stdout === "string" ? result.stdout : "");
    if (!parsed) {
      snapshot = Object.freeze(
        Object.fromEntries(CAPABILITY_BINDINGS.map(([capability]) => [
          capability,
          failedProbe("native-probe-invalid-output"),
        ])),
      );
      return snapshot;
    }

    snapshot = parsed;
    return snapshot;
  }

  return Object.freeze(
    Object.fromEntries(
      CAPABILITY_BINDINGS.map(([capability]) => [
        capability,
        () => execute()[capability],
      ]),
    ),
  );
}
