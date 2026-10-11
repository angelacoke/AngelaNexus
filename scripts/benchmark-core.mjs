#!/usr/bin/env node
import fs from "node:fs";
import { runBenchmark, compareBenchmarks, listBenchmarkWorkloads, RESOURCE_BENCHMARK_VERSION } from "../src/core/resource-benchmark.js";

function usage() {
  console.log(`AngelaNexus core benchmark (v${RESOURCE_BENCHMARK_VERSION})

Usage: node scripts/benchmark-core.mjs [options]

Options:
  --smoke                 tiny run for CI smoke testing
  --iterations N          measured iterations per workload (default 200)
  --warmup N              warmup iterations per workload (default 20)
  --seed N                fixture seed (default 1)
  --nodes N               synthetic nodes per fixture (default 50)
  --rules N               synthetic rules per fixture (default 200)
  --flows N               synthetic flows per fixture (default 200)
  --workloads a,b,c       subset of: ${listBenchmarkWorkloads().join(", ")}
  --save <file>           write JSON report to <file>
  --compare <file>        compare against a saved baseline report
  --max-regression <pct>  regression threshold in percent (default 50)
  --min-duration-ms N     calibrate fast workloads to at least N ms measured (default 500, 0 in --smoke)
  --json                  print only the JSON report

Exit codes: 0 ok, 2 bad arguments, 3 resource regression detected.
`);
}

function parseArgs(argv) {
  const options = {
    iterations: 200, warmup: 20, seed: 1, nodes: 50, rules: 200, flows: 200,
    workloads: null, save: null, compare: null, maxRegression: 50, json: false, smoke: false,
    minDurationMs: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeNumber = () => {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value)) throw new Error("expected a number after " + arg);
      return value;
    };
    if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--iterations") options.iterations = takeNumber();
    else if (arg === "--warmup") options.warmup = takeNumber();
    else if (arg === "--seed") options.seed = takeNumber();
    else if (arg === "--nodes") options.nodes = takeNumber();
    else if (arg === "--rules") options.rules = takeNumber();
    else if (arg === "--flows") options.flows = takeNumber();
    else if (arg === "--max-regression") options.maxRegression = takeNumber();
    else if (arg === "--min-duration-ms") options.minDurationMs = takeNumber();
    else if (arg === "--workloads") options.workloads = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--save") options.save = String(argv[++i]);
    else if (arg === "--compare") options.compare = String(argv[++i]);
    else throw new Error("unknown argument: " + arg);
  }
  if (options.smoke) {
    options.iterations = 5;
    options.warmup = 2;
    options.nodes = 10;
    options.rules = 20;
    options.flows = 20;
    options.minDurationMs = 0;
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error("error: " + error.message);
    usage();
    process.exit(2);
  }

  const report = runBenchmark({
    seed: options.seed,
    iterations: options.iterations,
    warmup: options.warmup,
    nodeCount: options.nodes,
    ruleCount: options.rules,
    flowCount: options.flows,
    workloads: options.workloads,
    minDurationMs: options.minDurationMs,
  });

  if (options.save) {
    fs.writeFileSync(options.save, JSON.stringify(report, null, 2) + "\n");
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("AngelaNexus core benchmark v" + report.benchmarkVersion +
      " — node " + report.node + " " + report.platform + "/" + report.arch +
      " — seed " + report.seed);
    for (const workload of report.workloads) {
      console.log(
        "  " + workload.name.padEnd(12) +
        String(workload.iterations).padStart(6) + " ops" +
        "  " + Math.round(workload.nsPerOp).toLocaleString("en-US").padStart(14) + " ns/op" +
        "  " + Math.round(workload.opsPerSec).toLocaleString("en-US").padStart(12) + " ops/s" +
        "  heap Δ " + (workload.heapDeltaMB >= 0 ? "+" : "") + workload.heapDeltaMB + " MB",
      );
    }
    console.log("  total " + (report.totalNs / 1e9).toFixed(2) + "s");
  }

  if (options.compare) {
    const baseline = JSON.parse(fs.readFileSync(options.compare, "utf8"));
    const comparison = compareBenchmarks(baseline, report, options.maxRegression / 100);
    if (!options.json) {
      for (const item of comparison.comparisons) {
        if (item.status === "no-baseline") {
          console.log("  " + item.name + ": no baseline entry (skipped)");
        } else {
          const pct = (item.deltaRatio * 100).toFixed(1);
          console.log("  " + item.name + ": " + (pct >= 0 ? "+" : "") + pct + "% vs baseline" +
            (item.status === "regressed" ? "  REGRESSED" : "  ok"));
        }
      }
    }
    if (!comparison.ok) {
      console.error("resource regression detected in: " + comparison.regressions.join(", ") +
        " (threshold " + options.maxRegression + "%). Resolve or explicitly justify before progression.");
      process.exit(3);
    }
    if (!options.json) console.log("no resource regression beyond " + options.maxRegression + "% threshold.");
  }
}

main();
