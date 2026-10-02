import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../core/model.js";
import { inspectKernelSynchronization, requireKernelSynchronization, REQUIRED_KERNELS } from "./kernel-synchronization.js";

test("all three execution kernels are registered and synchronized", () => {
  const report = inspectKernelSynchronization();
  assert.equal(report.ok, true);
  assert.deepEqual(report.requiredKernels, [
    Kernels.MIHOMO,
    Kernels.SING_BOX,
    Kernels.XRAY,
  ]);
  assert.equal(report.missing.length, 0);
  assert.equal(report.kernels.length, REQUIRED_KERNELS.length);
  for (const kernel of report.kernels) {
    assert.equal(kernel.adapter, true);
    assert.equal(kernel.driver, true);
    assert.equal(kernel.configCompile, true);
    assert.equal(kernel.chainCompile, true);
    assert.equal(kernel.capabilities.includes("process-runtime"), true);
  }
});

test("synchronization gate is fail-closed", () => {
  assert.equal(requireKernelSynchronization().ok, true);
});
