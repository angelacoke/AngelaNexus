export const LINUX_NFTABLES_TRANSACTION_VERSION = 1;

export const LinuxNftablesTransactionStates = Object.freeze({
  IDLE: "idle",
  SNAPSHOTTED: "snapshotted",
  APPLIED: "applied",
  COMMITTED: "committed",
  ROLLED_BACK: "rolled-back",
  FAILED: "failed",
  BUSY: "busy",
});

function requiredOperation(executor, name) {
  if (!executor || typeof executor[name] !== "function") {
    throw new TypeError(`nftables transaction executor requires ${name}()`);
  }
}

function normalizeValidation(result) {
  if (result === true) return { ok: true, reason: null };
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "validation-failed" };
  }
  return {
    ok: result.ok === true,
    reason: typeof result.reason === "string"
      ? result.reason
      : (result.ok === true ? null : "validation-failed"),
  };
}

/**
 * Provides the platform safety boundary for nftables changes.
 *
 * The executor owns the actual privileged nftables operation. This layer
 * guarantees snapshot -> apply -> validate -> commit, with restoration on
 * apply/validation failure. A failed restoration is never reported as safe.
 */
export function createLinuxNftablesTransaction({
  executor,
  clock = () => Date.now(),
} = {}) {
  requiredOperation(executor, "snapshot");
  requiredOperation(executor, "apply");
  requiredOperation(executor, "validate");
  requiredOperation(executor, "restore");

  let state = LinuxNftablesTransactionStates.IDLE;
  let snapshot = null;
  let startedAt = null;
  let finishedAt = null;
  let executing = false;

  const result = (ok, reason = null, extra = {}) => Object.freeze({
    ok,
    state,
    reason,
    startedAt,
    finishedAt,
    ...extra,
  });

  const rollback = (reason) => {
    try {
      executor.restore(snapshot);
      state = LinuxNftablesTransactionStates.ROLLED_BACK;
      finishedAt = clock();
      return result(false, reason, { restored: true });
    } catch (error) {
      state = LinuxNftablesTransactionStates.FAILED;
      finishedAt = clock();
      return result(false, "rollback-failed", {
        restored: false,
        rollbackError: String(error?.message || error),
      });
    }
  };

  const execute = (plan) => {
    if (executing) {
      state = LinuxNftablesTransactionStates.BUSY;
      finishedAt = clock();
      return result(false, "transaction-busy");
    }
    if (!plan || typeof plan !== "object") {
      state = LinuxNftablesTransactionStates.FAILED;
      finishedAt = clock();
      return result(false, "plan-required");
    }

    state = LinuxNftablesTransactionStates.IDLE;
    snapshot = null;
    startedAt = clock();
    finishedAt = null;

    executing = true;
    try {
      snapshot = executor.snapshot();
      state = LinuxNftablesTransactionStates.SNAPSHOTTED;

      executor.apply(plan);
      state = LinuxNftablesTransactionStates.APPLIED;

      const validation = normalizeValidation(executor.validate(plan));
      if (!validation.ok) {
        return rollback(validation.reason);
      }

      state = LinuxNftablesTransactionStates.COMMITTED;
      finishedAt = clock();
      return result(true, null, { restored: false });
    } catch (error) {
      return rollback(String(error?.message || error));
    } finally {
      executing = false;
    }
  };

  return Object.freeze({
    version: LINUX_NFTABLES_TRANSACTION_VERSION,
    execute,
    getState: () => state,
  });
}
