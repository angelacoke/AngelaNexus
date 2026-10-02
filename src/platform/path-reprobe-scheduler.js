export const PATH_REPROBE_SCHEDULER_VERSION = 1;

export const ReprobeStates = Object.freeze({
  IDLE: "idle",
  SCHEDULED: "scheduled",
  PROBING: "probing",
  COOLDOWN: "cooldown",
  CANCELLED: "cancelled",
});

function positiveInt(value, fallback, max) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function positiveNumber(value, fallback, max) {
  return Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

function backoff(baseMs, maxMs, attempt) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

export function createPathReprobeScheduler({
  userPolicy = {},
  now = () => Date.now(),
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const policy = Object.freeze({
    enabled: userPolicy.enabled === true,
    minIntervalMs: positiveNumber(userPolicy.minIntervalMs, 30_000, 86_400_000),
    baseBackoffMs: positiveNumber(userPolicy.baseBackoffMs, 30_000, 86_400_000),
    maxBackoffMs: positiveNumber(userPolicy.maxBackoffMs, 15 * 60_000, 7 * 86_400_000),
    cooldownMs: positiveNumber(userPolicy.cooldownMs, 60_000, 7 * 86_400_000),
    maxAttempts: positiveInt(userPolicy.maxAttempts, 3, 10),
    lowPower: userPolicy.lowPower !== false,
    lowPowerMinIntervalMs: positiveNumber(userPolicy.lowPowerMinIntervalMs, 5 * 60_000, 7 * 86_400_000),
  });

  const tasks = new Map();

  function effectiveInterval() {
    return policy.lowPower ? Math.max(policy.minIntervalMs, policy.lowPowerMinIntervalMs) : policy.minIntervalMs;
  }

  function snapshotTask(task) {
    return Object.freeze({ ...task });
  }

  function schedule(pathId, { reason = "reprobe-recommended", recommended = true } = {}) {
    const id = typeof pathId === "string" ? pathId.trim() : "";
    if (!id) return Object.freeze({ ok: false, reason: "invalid-path-id" });
    if (!policy.enabled) return Object.freeze({ ok: false, reason: "disabled" });
    if (recommended !== true) return Object.freeze({ ok: false, reason: "not-recommended" });

    const current = tasks.get(id);
    const timestamp = now();
    if (current?.state === ReprobeStates.PROBING) {
      return Object.freeze({ ok: false, reason: "already-probing", task: snapshotTask(current) });
    }
    if (current?.state === ReprobeStates.SCHEDULED && current.nextAttemptAt > timestamp) {
      return Object.freeze({ ok: true, scheduled: false, reason: "already-scheduled", task: snapshotTask(current) });
    }

    const attempt = current?.attempts || 0;
    if (attempt >= policy.maxAttempts && current?.state === ReprobeStates.COOLDOWN) {
      return Object.freeze({ ok: false, reason: "attempt-limit" });
    }

    const lastCompletedAt = current?.lastCompletedAt || 0;
    const earliest = lastCompletedAt + effectiveInterval();
    const nextAttemptAt = Math.max(timestamp, earliest, timestamp + backoff(policy.baseBackoffMs, policy.maxBackoffMs, attempt + 1));

    const task = {
      pathId: id,
      state: ReprobeStates.SCHEDULED,
      reason,
      attempts: attempt,
      nextAttemptAt,
      lastCompletedAt,
      createdAt: current?.createdAt || timestamp,
    };
    tasks.set(id, task);
    return Object.freeze({ ok: true, scheduled: true, task: snapshotTask(task) });
  }

  function poll() {
    const timestamp = now();
    const ready = [];
    for (const task of tasks.values()) {
      if (task.state === ReprobeStates.SCHEDULED && task.nextAttemptAt <= timestamp) {
        ready.push(snapshotTask(task));
      }
    }
    return Object.freeze(ready);
  }

  function begin(pathId) {
    const id = typeof pathId === "string" ? pathId.trim() : "";
    const task = tasks.get(id);
    if (!task) return Object.freeze({ ok: false, reason: "task-not-found" });
    if (task.state !== ReprobeStates.SCHEDULED) {
      return Object.freeze({ ok: false, reason: "task-not-ready", state: task.state });
    }
    if (task.nextAttemptAt > now()) {
      return Object.freeze({ ok: false, reason: "not-due", task: snapshotTask(task) });
    }

    const updated = {
      ...task,
      state: ReprobeStates.PROBING,
      attempts: task.attempts + 1,
      startedAt: now(),
    };
    tasks.set(id, updated);
    return Object.freeze({ ok: true, task: snapshotTask(updated) });
  }

  function complete(pathId, { success, securityHealthy = true, userAllowed = true, verified = true } = {}) {
    const id = typeof pathId === "string" ? pathId.trim() : "";
    const task = tasks.get(id);
    if (!task) return Object.freeze({ ok: false, reason: "task-not-found" });
    if (task.state !== ReprobeStates.PROBING) {
      return Object.freeze({ ok: false, reason: "task-not-probing" });
    }

    const timestamp = now();
    const gatesPass = success === true && securityHealthy === true && userAllowed === true && verified === true;
    const updated = {
      ...task,
      state: gatesPass ? ReprobeStates.COOLDOWN : ReprobeStates.SCHEDULED,
      completedAt: timestamp,
      lastCompletedAt: timestamp,
      nextAttemptAt: gatesPass
        ? timestamp + policy.cooldownMs
        : timestamp + backoff(policy.baseBackoffMs, policy.maxBackoffMs, task.attempts + 1),
    };

    if (!gatesPass && task.attempts >= policy.maxAttempts) {
      updated.state = ReprobeStates.COOLDOWN;
      updated.nextAttemptAt = timestamp + policy.cooldownMs;
    }

    tasks.set(id, updated);
    return Object.freeze({
      ok: true,
      success: gatesPass,
      reinstatable: gatesPass,
      task: snapshotTask(updated),
    });
  }

  function cancel(pathId) {
    const id = typeof pathId === "string" ? pathId.trim() : "";
    const task = tasks.get(id);
    if (!task) return Object.freeze({ ok: false, reason: "task-not-found" });
    const updated = { ...task, state: ReprobeStates.CANCELLED, cancelledAt: now() };
    tasks.set(id, updated);
    return Object.freeze({ ok: true, task: snapshotTask(updated) });
  }

  function get(pathId) {
    return tasks.get(pathId) ? snapshotTask(tasks.get(pathId)) : null;
  }

  function list() {
    return Object.freeze([...tasks.values()].map(snapshotTask));
  }

  function snapshot() {
    return Object.freeze({
      version: PATH_REPROBE_SCHEDULER_VERSION,
      policy,
      taskCount: tasks.size,
    });
  }

  return Object.freeze({
    version: PATH_REPROBE_SCHEDULER_VERSION,
    schedule,
    poll,
    begin,
    complete,
    cancel,
    get,
    list,
    snapshot,
  });
}
