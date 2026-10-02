import test from "node:test";
import assert from "node:assert/strict";
import {
  createFlowEvidence,
  createFlowTelemetry,
  summarizeFlowTelemetry,
} from "../src/platform/network-telemetry.js";

test("flow telemetry preserves provenance and does not infer process identity", () => {
  const evidence = createFlowEvidence({
    originalDestination: "203.0.113.10:443",
    source: "kernel",
    confidence: "verified",
  });
  assert.equal(evidence.processId, null);
  const flow = createFlowTelemetry({
    id: "flow-1",
    backend: "linux-tproxy",
    evidence,
    rttMs: 42,
    deliveryRateBps: 1000000,
  });
  assert.equal(flow.evidence.processId, null);
  assert.equal(flow.metrics.rttMs, 42);
});

test("telemetry summary is bounded and lifecycle-aware", () => {
  const flows = [
    createFlowTelemetry({ id: "a", backend: "linux-tun", state: "active" }),
    createFlowTelemetry({ id: "b", backend: "linux-tun", state: "draining" }),
    createFlowTelemetry({ id: "c", backend: "linux-tun", state: "closed" }),
  ];
  assert.deepEqual(summarizeFlowTelemetry(flows), {
    version: 1,
    flowCount: 3,
    active: 2,
    draining: 1,
    closed: 1,
    failed: 0,
  });
});
