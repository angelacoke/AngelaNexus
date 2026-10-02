import test from "node:test";
import assert from "node:assert/strict";
import {
  createTransparentLifecycle,
  TransparentLifecycleStates,
  canAdmitNewFlows,
} from "../src/platform/transparent-lifecycle.js";

test("backend switching drains before activation", () => {
  const lifecycle = createTransparentLifecycle();
  lifecycle.beginAdmission("linux-tun");
  lifecycle.activate();
  assert.equal(canAdmitNewFlows(lifecycle.snapshot()), true);
  lifecycle.beginDrain();
  assert.equal(canAdmitNewFlows(lifecycle.snapshot()), false);
  lifecycle.markDrained();
  lifecycle.beginActivation("linux-tproxy");
  lifecycle.activate();
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
  assert.equal(lifecycle.snapshot().activeBackend, "linux-tproxy");
});

test("failed activation can roll back to the previous backend", () => {
  const lifecycle = createTransparentLifecycle();
  lifecycle.beginAdmission("linux-tun");
  lifecycle.activate();
  lifecycle.beginDrain();
  lifecycle.markDrained();
  lifecycle.beginActivation("linux-tproxy");
  lifecycle.rollback("health-check-failed");
  const rollback = lifecycle.snapshot();
  assert.equal(rollback.state, TransparentLifecycleStates.ROLLING_BACK);
  lifecycle.recover();
  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.ACTIVE);
  assert.equal(lifecycle.snapshot().activeBackend, "linux-tun");
  assert.equal(canAdmitNewFlows(lifecycle.snapshot()), true);
});

test("failed lifecycle cannot silently re-enter admission or activation", () => {
  const lifecycle = createTransparentLifecycle();
  lifecycle.beginAdmission("linux-tun");
  lifecycle.activate();
  lifecycle.fail("kernel-rollback-failed");

  const failed = lifecycle.snapshot();
  assert.equal(failed.state, TransparentLifecycleStates.FAILED);
  assert.equal(failed.admitted, false);
  assert.equal(canAdmitNewFlows(failed), false);

  assert.throws(
    () => lifecycle.beginAdmission("linux-tproxy"),
    /cannot begin admission from failed/,
  );
  assert.throws(
    () => lifecycle.activate(),
    /cannot activate from failed/,
  );
  assert.throws(
    () => lifecycle.beginDrain(),
    /cannot drain from failed/,
  );
  assert.throws(
    () => lifecycle.recover(),
    /cannot recover from failed/,
  );

  assert.equal(lifecycle.snapshot().state, TransparentLifecycleStates.FAILED);
  assert.equal(canAdmitNewFlows(lifecycle.snapshot()), false);
});

