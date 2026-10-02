import { PathProbeResults } from "./path-probe-executor.js";

export const PATH_REPROBE_RUNTIME_VERSION = 1;

function outcomeFromProbeResult(result) {
  if (result === PathProbeResults.SUCCESS) return "success";
  if (result === PathProbeResults.DEGRADED) return "degraded";
  return "failure";
}

export function createPathReprobeRuntime({
  scheduler,
  executor,
  pathRegistry,
  pathManager,
  evidenceStore,
  now = () => Date.now(),
} = {}) {
  if (!scheduler || typeof scheduler.poll !== "function" || typeof scheduler.begin !== "function" || typeof scheduler.complete !== "function") {
    throw new TypeError("scheduler is required");
  }
  if (!executor || typeof executor.execute !== "function") throw new TypeError("executor is required");
  if (!pathRegistry || typeof pathRegistry.get !== "function") throw new TypeError("pathRegistry is required");
  if (!pathManager || typeof pathManager.recordOutcome !== "function") throw new TypeError("pathManager is required");
  if (!evidenceStore || typeof evidenceStore.record !== "function") throw new TypeError("evidenceStore is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  async function runDue({ limit = 8 } = {}) {
    const boundedLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 32) : 8;
    const due = scheduler.poll().slice(0, boundedLimit);
    const results = [];

    for (const task of due) {
      const started = now();
      const begun = scheduler.begin(task.pathId);
      if (!begun.ok) {
        results.push(Object.freeze({ pathId: task.pathId, ok: false, reason: begun.reason }));
        continue;
      }

      const path = pathRegistry.get(task.pathId);
      if (!path) {
        scheduler.complete(task.pathId, {
          success: false,
          securityHealthy: false,
          userAllowed: false,
          verified: false,
        });
        results.push(Object.freeze({ pathId: task.pathId, ok: false, reason: "path-not-found" }));
        continue;
      }

      const probe = await executor.execute(
        { pathId: task.pathId, reason: task.reason, attempts: begun.task.attempts },
        {
          userAllowed: path.userAllowed === true,
          securityHealthy: path.securityHealthy === true,
          verified: path.verified === true,
        },
      );

      const outcome = outcomeFromProbeResult(probe.result);
      const recorded = pathManager.recordOutcome({
        pathId: task.pathId,
        outcome,
        evidenceStore,
        pathRegistry,
        decisionId: task.decisionId || null,
        source: "path-reprobe",
        metrics: {
          connectionSetupMs: Math.max(0, now() - started),
        },
        attributes: {
          reprobeAttempt: begun.task.attempts,
          probeResult: probe.result,
        },
      });

      const completion = scheduler.complete(task.pathId, {
        success: outcome === "success",
        securityHealthy: path.securityHealthy === true,
        userAllowed: path.userAllowed === true,
        verified: path.verified === true,
      });

      results.push(Object.freeze({
        pathId: task.pathId,
        ok: recorded.ok && completion.ok,
        outcome,
        probe,
        recorded,
        completion,
      }));
    }

    return Object.freeze(results);
  }

  return Object.freeze({
    version: PATH_REPROBE_RUNTIME_VERSION,
    runDue,
  });
}
