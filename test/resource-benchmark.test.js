import test from "node:test";
import assert from "node:assert/strict";
import {
  runBenchmark,
  compareBenchmarks,
  listBenchmarkWorkloads,
  RESOURCE_BENCHMARK_VERSION,
} from "../src/core/resource-benchmark.js";

function smokeReport() {
  return runBenchmark({ seed: 1, iterations: 5, warmup: 2, nodeCount: 10, ruleCount: 20, flowCount: 20, minDurationMs: 0 });
}

test("benchmark lists the expected workloads", () => {
  assert.deepEqual(listBenchmarkWorkloads(), ["sniff", "import", "validate", "rule-match", "route-compile"]);
});

test("benchmark report carries version, environment and per-workload measurements", () => {
  const report = smokeReport();
  assert.equal(report.benchmarkVersion, RESOURCE_BENCHMARK_VERSION);
  assert.equal(typeof report.node, "string");
  assert.equal(typeof report.platform, "string");
  assert.equal(report.iterations, 5);
  assert.equal(report.workloads.length, 5);
  for (const workload of report.workloads) {
    assert.equal(typeof workload.name, "string");
    assert.equal(workload.iterations, 5);
    assert.ok(workload.totalNs > 0);
    assert.ok(workload.nsPerOp > 0);
    assert.ok(workload.opsPerSec > 0);
    assert.equal(typeof workload.heapDeltaMB, "number");
  }
});

test("benchmark fixtures are deterministic for a fixed seed", () => {
  const first = runBenchmark({ seed: 7, iterations: 3, warmup: 1, nodeCount: 10, ruleCount: 10, flowCount: 10 });
  const second = runBenchmark({ seed: 7, iterations: 3, warmup: 1, nodeCount: 10, ruleCount: 10, flowCount: 10 });
  assert.deepEqual(
    first.workloads.map((w) => w.name),
    second.workloads.map((w) => w.name),
  );
  assert.equal(first.workloads.length, second.workloads.length);
});

test("benchmark supports workload subset selection", () => {
  const report = runBenchmark({
    seed: 1, iterations: 3, warmup: 1, nodeCount: 5, ruleCount: 5, flowCount: 5,
    workloads: ["sniff", "validate"],
  });
  assert.deepEqual(report.workloads.map((w) => w.name), ["sniff", "validate"]);
});

test("benchmark rejects invalid options", () => {
  assert.throws(() => runBenchmark({ iterations: 0 }), /positive integer/);
  assert.throws(() => runBenchmark({ workloads: ["nope"] }), /no workloads selected/);
});

test("calibration boosts iterations for fast workloads without reducing slow ones", () => {
  const report = runBenchmark({
    seed: 1, iterations: 5, warmup: 10, nodeCount: 5, ruleCount: 5, flowCount: 5,
    minDurationMs: 200, workloads: ["sniff"],
  });
  const sniff = report.workloads[0];
  assert.ok(sniff.iterations >= 5);
  assert.ok(sniff.totalNs >= 200 * 1e6 * 0.5, "calibrated run should cover a meaningful duration, got " + sniff.totalNs);
});

test("comparison passes when current is within the regression threshold", () => {
  const baseline = smokeReport();
  const current = smokeReport();
  const result = compareBenchmarks(baseline, current, 5.0);
  assert.equal(result.ok, true);
  assert.deepEqual(result.regressions, []);
  assert.equal(result.comparisons.length, 5);
});

test("comparison flags a workload that regressed beyond the threshold", () => {
  const baseline = smokeReport();
  const current = JSON.parse(JSON.stringify(baseline));
  const target = current.workloads.find((w) => w.name === "rule-match");
  target.nsPerOp = target.nsPerOp * 3;
  const result = compareBenchmarks(baseline, current, 0.2);
  assert.equal(result.ok, false);
  assert.deepEqual(result.regressions, ["rule-match"]);
  const entry = result.comparisons.find((c) => c.name === "rule-match");
  assert.equal(entry.status, "regressed");
  assert.ok(entry.deltaRatio > 0.2);
});

test("comparison skips workloads missing from the baseline", () => {
  const full = smokeReport();
  const baseline = { ...full, workloads: full.workloads.filter((w) => w.name !== "sniff") };
  const current = smokeReport();
  const result = compareBenchmarks(baseline, current, 0.2);
  const entry = result.comparisons.find((c) => c.name === "sniff");
  assert.equal(entry.status, "no-baseline");
});

test("comparison rejects incompatible report versions", () => {
  const baseline = { ...smokeReport(), benchmarkVersion: 999 };
  assert.throws(() => compareBenchmarks(baseline, smokeReport(), 0.2), /incompatible baseline/);
});
