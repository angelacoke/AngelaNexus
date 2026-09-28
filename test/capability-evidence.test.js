import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { getAllKernelCapabilityEvidence, getKernelCapabilityEvidence } from "../src/core/capability-evidence.js";

test("capability evidence is available for every kernel", () => {
  const evidence = getAllKernelCapabilityEvidence();
  assert.equal(evidence.length, Object.values(Kernels).length);
  for (const item of evidence) {
    assert.equal(item.version.stable !== undefined, true);
    assert.match(item.protocols.source, /^https:\/\//);
    assert.match(item.features.source, /^https:\/\//);
    assert.ok(item.protocols.scope);
    assert.ok(item.features.scope);
  }
});

test("unsupported kernel evidence lookup fails closed", () => {
  assert.throws(() => getKernelCapabilityEvidence("unknown"), /unsupported kernel/);
});
