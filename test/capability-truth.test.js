import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCapabilityTruth,
  capabilityTruthFromBackend,
  requireCapabilityTruth,
  CapabilityTruthStates,
} from "../src/platform/capability-truth.js";

test("capability truth never promotes operational state without verification", () => {
  const result = evaluateCapabilityTruth({
    id: "test-backend",
    declared: true,
    supported: true,
    verified: false,
    operational: true,
    healthy: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, "supported");
  assert.ok(result.contradictions.includes("operational-without-verification"));
});

test("supported backend becomes verified only through declared support or evidence", () => {
  const result = capabilityTruthFromBackend(
    { id: "android-root", maturity: "capability-gated" },
    { "android-root": true },
    { operational: true, healthy: true }
  );
  assert.equal(result.state, CapabilityTruthStates.HEALTHY);
  assert.equal(requireCapabilityTruth(result, CapabilityTruthStates.VERIFIED), true);
});

test("unsupported evidence cannot manufacture support", () => {
  const result = evaluateCapabilityTruth({
    id: "fake",
    declared: false,
    supported: false,
    verified: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, null);
});
