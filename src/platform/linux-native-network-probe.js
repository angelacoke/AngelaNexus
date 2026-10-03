import { spawnSync } from "node:child_process";
import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

export const LINUX_NATIVE_NETWORK_PROBE_RUNTIME_VERSION = 6;

const ROUTE_LOOKUP_PATTERN = /^route-family=(ipv4|ipv6) target=(\S+) lookup-state=(-1|0|1) route-type=([0-9]+) interface-index=([0-9]+) table-id=([0-9]+) target-match=(0|1)\s*$/;

const ROUTE_TYPE_NAMES = Object.freeze({
  1: "unicast",
  6: "unreachable",
  7: "prohibit",
  8: "blackhole",
  9: "throw",
});

const CAPABILITY_BINDINGS = Object.freeze([
  [LinuxCapabilities.IPV4, "ipv4"],
  [LinuxCapabilities.IPV6, "ipv6"],
  [LinuxCapabilities.POLICY_ROUTE, "policy-route"],
  [LinuxCapabilities.NFTABLES, "nftables"],
]);

const RESULT_PATTERN = /^ipv4=(-1|0|1) ipv6=(-1|0|1) policy-route=(-1|0|1) nftables=(-1|0|1) policy-rules=([0-9]+) ipv4-routes=([0-9]+) ipv6-routes=([0-9]+) ipv4-default-routes=([0-9]+) ipv6-default-routes=([0-9]+) ipv4-route-state=(-1|0|1) ipv6-route-state=(-1|0|1) nft-tables=([0-9]+) nft-chains=([0-9]+)\s*$/;

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
        evidence.ipv4DefaultRouteCount = Number(match[8]);
        evidence.ipv6DefaultRouteCount = Number(match[9]);
        evidence.ipv4RouteState = mapRawResult(Number(match[10]));
        evidence.ipv6RouteState = mapRawResult(Number(match[11]));
      }
      if (capability === LinuxCapabilities.NFTABLES) {
        evidence.nftTableCount = Number(match[12]);
        evidence.nftChainCount = Number(match[13]);
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


export function createLinuxNativeRouteLookup({ commandPath, spawnSyncImpl = spawnSync, timeoutMs = 1500 } = {}) {
  if (typeof commandPath !== "string" || commandPath.length === 0) {
    throw new TypeError("native Linux network probe command path is required");
  }
  if (typeof spawnSyncImpl !== "function") {
    throw new TypeError("spawnSync implementation is required");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new RangeError("native route lookup timeout must be between 1 and 10000 ms");
  }

  return Object.freeze({
    lookup(family, target) {
      const flag = family === "ipv4" ? "--route4" : family === "ipv6" ? "--route6" : null;
      if (!flag || typeof target !== "string" || !target.trim()) {
        return Object.freeze({ ok: false, ready: false, reason: "route-lookup-invalid-input" });
      }

      let result;
      try {
        result = spawnSyncImpl(commandPath, [flag, target.trim()], {
          encoding: "utf8",
          timeout: timeoutMs,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        return Object.freeze({
          ok: false,
          ready: false,
          reason: "route-lookup-exception",
          error: String(error?.message || error),
        });
      }

      if (result?.error) {
        return Object.freeze({
          ok: false,
          ready: false,
          reason: result.signal === "SIGTERM" ? "route-lookup-timeout" : "route-lookup-error",
        });
      }
      if (result?.status !== 0) {
        return Object.freeze({
          ok: false,
          ready: false,
          reason: "route-lookup-nonzero-exit",
          status: result?.status ?? null,
        });
      }

      const match = ROUTE_LOOKUP_PATTERN.exec(typeof result.stdout === "string" ? result.stdout.trim() : "");
      if (!match || match[1] !== family || match[2] !== target.trim()) {
        return Object.freeze({ ok: false, ready: false, reason: "route-lookup-invalid-output" });
      }

      const lookupState = mapRawResult(Number(match[3]));
      const routeType = ROUTE_TYPE_NAMES[Number(match[4])] || "other";
      const interfaceIndex = Number(match[5]);
      const tableId = Number(match[6]);
      const targetMatch = match[7] === "1";
      const ready = lookupState === LinuxCapabilityStates.VERIFIED &&
        routeType === "unicast" &&
        Number.isInteger(interfaceIndex) && interfaceIndex > 0 &&
        Number.isInteger(tableId) && tableId >= 0 &&
        targetMatch;

      return Object.freeze({
        ok: true,
        ready,
        reason: ready ? "effective-route-verified" : "effective-route-not-verified",
        family,
        target: target.trim(),
        evidence: Object.freeze({
          lookupState,
          routeType,
          interfaceIndex,
          tableId,
          targetMatch,
          source: "native-linux-route-lookup-command",
        }),
      });
    },
  });
}
