import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_KERNELS,
  REQUIRED_SYNCHRONIZATION_CAPABILITIES,
  assertKernelSynchronization,
  inspectKernelSynchronization
} from "../src/core/kernel-synchronization.js";

test("all three required kernels pass the synchronization gate", () => {
  const report = inspectKernelSynchronization();
  assert.equal(report.ok, true);
  assert.deepEqual(report.requiredKernels, REQUIRED_KERNELS);
  assert.equal(report.kernels.length, 3);
  for (const kernel of report.kernels) {
    assert.equal(kernel.ok, true);
    for (const capability of REQUIRED_SYNCHRONIZATION_CAPABILITIES) {
      assert.ok(kernel.adapter.capabilities.includes(capability));
    }
    assert.ok(kernel.upstream.repository);
    assert.ok(kernel.upstream.stable);
    assert.ok(kernel.conformance.fixtures.length > 0);
    assert.ok(Object.keys(kernel.conformance.capabilityProbes).length > 0);
  }
});

test("the assertion returns the verified synchronization report", () => {
  const report = assertKernelSynchronization();
  assert.equal(report.ok, true);
  assert.equal(report.kernels.every(kernel => kernel.ok), true);
});
