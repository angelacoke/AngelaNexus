import test from "node:test";
import assert from "node:assert/strict";
import {
  LINUX_NFTABLES_TRANSACTION_VERSION,
  LinuxNftablesTransactionStates,
  createLinuxNftablesTransaction,
} from "./linux-nftables-transaction.js";

test("commits only after apply and validation", () => {
  const calls = [];
  const tx = createLinuxNftablesTransaction({
    executor: {
      snapshot: () => {
        calls.push("snapshot");
        return { generation: 1 };
      },
      apply: (plan) => calls.push(["apply", plan.id]),
      validate: () => {
        calls.push("validate");
        return { ok: true };
      },
      restore: () => calls.push("restore"),
    },
    clock: (() => {
      let value = 100;
      return () => ++value;
    })(),
  });

  const result = tx.execute({ id: "baseline" });

  assert.equal(LINUX_NFTABLES_TRANSACTION_VERSION, 1);
  assert.equal(result.ok, true);
  assert.equal(result.state, LinuxNftablesTransactionStates.COMMITTED);
  assert.equal(result.restored, false);
  assert.deepEqual(calls, ["snapshot", ["apply", "baseline"], "validate"]);
});

test("validation failure restores the pre-change snapshot", () => {
  const calls = [];
  const tx = createLinuxNftablesTransaction({
    executor: {
      snapshot: () => {
        calls.push("snapshot");
        return { generation: 7 };
      },
      apply: () => calls.push("apply"),
      validate: () => {
        calls.push("validate");
        return { ok: false, reason: "post-state-invalid" };
      },
      restore: (snapshot) => {
        calls.push(["restore", snapshot.generation]);
      },
    },
  });

  const result = tx.execute({ id: "unsafe" });

  assert.equal(result.ok, false);
  assert.equal(result.state, LinuxNftablesTransactionStates.ROLLED_BACK);
  assert.equal(result.reason, "post-state-invalid");
  assert.equal(result.restored, true);
  assert.deepEqual(calls, ["snapshot", "apply", "validate", ["restore", 7]]);
});

test("apply failure restores the pre-change snapshot", () => {
  const calls = [];
  const tx = createLinuxNftablesTransaction({
    executor: {
      snapshot: () => {
        calls.push("snapshot");
        return { ruleset: "before" };
      },
      apply: () => {
        calls.push("apply");
        throw new Error("apply-failed");
      },
      validate: () => {
        calls.push("validate");
        return true;
      },
      restore: (snapshot) => calls.push(["restore", snapshot.ruleset]),
    },
  });

  const result = tx.execute({ id: "broken" });

  assert.equal(result.ok, false);
  assert.equal(result.state, LinuxNftablesTransactionStates.ROLLED_BACK);
  assert.equal(result.reason, "apply-failed");
  assert.equal(result.restored, true);
  assert.deepEqual(calls, ["snapshot", "apply", ["restore", "before"]]);
});

test("rollback failure is fail-closed", () => {
  const tx = createLinuxNftablesTransaction({
    executor: {
      snapshot: () => ({ ruleset: "before" }),
      apply: () => {
        throw new Error("apply-failed");
      },
      validate: () => true,
      restore: () => {
        throw new Error("restore-failed");
      },
    },
  });

  const result = tx.execute({ id: "broken" });

  assert.equal(result.ok, false);
  assert.equal(result.state, LinuxNftablesTransactionStates.FAILED);
  assert.equal(result.reason, "rollback-failed");
  assert.equal(result.restored, false);
  assert.match(result.rollbackError, /restore-failed/);
});

test("invalid plan fails before touching nftables", () => {
  const calls = [];
  const tx = createLinuxNftablesTransaction({
    executor: {
      snapshot: () => calls.push("snapshot"),
      apply: () => calls.push("apply"),
      validate: () => calls.push("validate"),
      restore: () => calls.push("restore"),
    },
  });

  const result = tx.execute(null);

  assert.equal(result.ok, false);
  assert.equal(result.state, LinuxNftablesTransactionStates.FAILED);
  assert.equal(result.reason, "plan-required");
  assert.deepEqual(calls, []);
});
