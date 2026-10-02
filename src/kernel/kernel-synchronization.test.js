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
    assert.equal(kernel.capabilities.includes("node-compile"), true);
    assert.equal(kernel.capabilities.includes("pipeline-compile"), true);
    assert.equal(kernel.capabilities.includes("process-runtime"), true);
    assert.equal(kernel.upstreamStable, true);
    assert.equal(kernel.upstreamRepository, true);
    assert.equal(kernel.conformanceVerification, true);
    assert.deepEqual(kernel.conformance.fixtures, ["vless-reality"]);
    assert.equal(typeof kernel.conformance.capabilityProbes.wireguard, "string");
    assert.equal(kernel.runtimeDeclared, true);
    assert.equal(Object.prototype.hasOwnProperty.call(kernel.runtime, "reloadSignal"), true);
  }
});

test("synchronization gate is fail-closed", () => {
  assert.equal(requireKernelSynchronization().ok, true);
});
