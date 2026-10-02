export const PATH_PROBE_EXECUTOR_VERSION = 2;

export const PathProbeResults = Object.freeze({
  SUCCESS: "success",
  DEGRADED: "degraded",
  FAILURE: "failure",
  REJECTED: "rejected",
});

function normalizeProbeResult(result) {
  if (typeof result === "string") {
    return Object.freeze({ result });
  }
  if (!result || typeof result !== "object") {
    return Object.freeze({ result: PathProbeResults.FAILURE });
  }
  return Object.freeze({ ...result });
}

export function createPathProbeExecutor({
  platform,
  capabilities = [],
  probe,
} = {}) {
  if (typeof platform !== "string" || !platform.trim()) {
    throw new TypeError("platform is required");
  }
  if (!Array.isArray(capabilities)) {
    throw new TypeError("capabilities must be an array");
  }
  if (typeof probe !== "function") {
    throw new TypeError("probe must be a function");
  }

  const capabilitySet = new Set(capabilities);
  const snapshot = Object.freeze({
    version: PATH_PROBE_EXECUTOR_VERSION,
    platform: platform.trim(),
    capabilities: Object.freeze([...capabilitySet]),
  });

  function canProbe(task, {
    userAllowed = true,
    securityHealthy = true,
    verified = true,
  } = {}) {
    const pathId = typeof task?.pathId === "string" ? task.pathId.trim() : "";
    return Object.freeze({
      ok: Boolean(
        pathId &&
        userAllowed === true &&
        securityHealthy === true &&
        verified === true &&
        capabilitySet.has("path-probe"),
      ),
      pathId,
      reason: !pathId
        ? "invalid-path"
        : userAllowed !== true
          ? "user-not-allowed"
          : securityHealthy !== true
            ? "security-unhealthy"
            : verified !== true
              ? "path-unverified"
              : !capabilitySet.has("path-probe")
                ? "capability-unavailable"
                : "ready",
    });
  }

  async function execute(task, context = {}) {
    const gate = canProbe(task, context);
    if (!gate.ok) {
      return Object.freeze({
        ok: false,
        result: PathProbeResults.REJECTED,
        reason: gate.reason,
        pathId: gate.pathId,
      });
    }

    const startedAt = Date.now();
    try {
      const nativeResult = await probe(Object.freeze({
        pathId: gate.pathId,
        reason: task.reason,
        attempt: task.attempts,
        platform: snapshot.platform,
      }));
      const normalizedNativeResult = normalizeProbeResult(nativeResult);
      const normalized = normalizedNativeResult.result === PathProbeResults.SUCCESS ||
        normalizedNativeResult.result === PathProbeResults.DEGRADED ||
        normalizedNativeResult.result === PathProbeResults.FAILURE
        ? normalizedNativeResult.result
        : PathProbeResults.FAILURE;

      return Object.freeze({
        ok: normalized !== PathProbeResults.FAILURE,
        result: normalized,
        pathId: gate.pathId,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(normalizedNativeResult.result === normalized
          ? Object.fromEntries(
              Object.entries(normalizedNativeResult).filter(([key]) => key !== "result"),
            )
          : {}),
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        result: PathProbeResults.FAILURE,
        reason: "probe-error",
        pathId: gate.pathId,
      });
    }
  }

  return Object.freeze({
    version: PATH_PROBE_EXECUTOR_VERSION,
    platform: snapshot.platform,
    capabilities: snapshot.capabilities,
    canProbe,
    execute,
  });
}
