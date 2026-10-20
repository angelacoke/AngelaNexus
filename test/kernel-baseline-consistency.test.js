import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { KernelVersions } from "../src/core/compatibility.js";
import { UpstreamKernelRegistry } from "../src/core/kernel-registry.js";

test("all baseline consumers derive stable versions from one registry", () => {
  assert.deepEqual(Object.keys(KernelVersions).sort(), Object.keys(UpstreamKernelRegistry).sort());

  for (const kernel of Object.values(Kernels)) {
    const upstream = UpstreamKernelRegistry[kernel];
    assert.ok(upstream, `missing upstream registry entry for ${kernel}`);
    assert.equal(upstream.channel, "stable");
    assert.match(upstream.stable, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    assert.equal(KernelVersions[kernel].stable, upstream.stable);
    assert.equal(KernelVersions[kernel].channel, upstream.channel);
  }
});
