# AngelaNexus Resource Benchmarks

## Purpose

The constitution (第二十四条：低资源优先) and the release policy require that
resource regressions be **measured** and resolved or explicitly justified before
progression. This harness provides the reproducible core-engine measurement
half of that requirement: deterministic, seeded benchmarks for the
platform-neutral core.

## What is measured

Five workloads, each with warmup + measured iterations:

| Workload      | What it exercises                                              |
|---------------|----------------------------------------------------------------|
| `sniff`       | `sniff()` format detection over share links and Clash YAML     |
| `import`      | `importConfig()` import pipeline (parse → normalize → unify)  |
| `validate`    | `validateCompiledConfig()` for Mihomo, sing-box and Xray       |
| `rule-match`  | `evaluateParallelMatchSet()` parallel rule matching            |
| `route-compile` | `compileRoutingPolicy()` for all three kernels               |

Per workload the report records: iterations, total ns, ns/op, ops/s, and heap
delta (MB, best effort — GC noise applies; run with `node --expose-gc` for a
tighter heap reading).

Fixtures are generated from a seeded PRNG (`mulberry32`), so the same seed
produces the same fixtures on every machine and every commit. Wall-clock time
still varies by hardware — compare runs on the same machine, or compare
relative ratios.

## What is NOT measured

Device dimensions require on-device measurement and are explicitly out of
scope: battery consumption, background wakeups, OS memory pressure, radio
usage, and kernel-runtime resource behavior. This harness covers core-engine
CPU/RAM only. Do not present these numbers as device measurements.

## Usage

```sh
npm run benchmark            # full run (defaults: 200 iterations)
npm run benchmark:smoke      # tiny CI-friendly run

node scripts/benchmark-core.mjs --help

# Save a baseline, then gate a change against it:
node scripts/benchmark-core.mjs --save /tmp/baseline.json
# ... make changes ...
node scripts/benchmark-core.mjs --compare /tmp/baseline.json --max-regression 20
```

Exit codes: `0` ok, `2` bad arguments, `3` resource regression beyond the
threshold. A regression exit does not auto-block anything by itself — per the
project's rules it must be investigated: fix the regression, or record an
explicit justification, before progression.

## Regression policy

- Default threshold: 50% slower ns/op vs baseline. Microsecond-scale workloads
  (e.g. `sniff` at ~1µs/op) vary ±30–40% across processes from JIT/GC noise
  even with iteration calibration; 50% catches real regressions (2x or worse)
  without false positives. Slower workloads (`import`, `rule-match`,
  `route-compile`) are stable within ±8% across runs.
- Tighten the threshold per workload for dedicated performance work
  (`--workloads rule-match --max-regression 15`).
- Baselines are machine-specific. Regenerate the baseline on the machine that
  runs the comparison; never compare numbers across different hardware.
- The comparison is advisory evidence for review, not a substitute for
  on-device measurement before release-channel advancement.

## Tests

`test/resource-benchmark.test.js` runs the harness in miniature (5 iterations)
and asserts report shape, workload selection, determinism of fixture
generation, and the compare/regression logic including the exit-relevant
`ok:false` path.
