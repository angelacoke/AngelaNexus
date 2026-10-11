import { sniff } from "./sniffer.js";
import { importConfig } from "./import-pipeline.js";
import { validateCompiledConfig } from "./compiled-config-validation.js";
import { evaluateParallelMatchSet } from "./parallel-rule-engine.js";
import { compileRoutingPolicy } from "./routing-compiler.js";
import { Kernels } from "./model.js";

/**
 * Reproducible core-engine benchmark library.
 *
 * Constitutional grounding: AN-Constitution 第二十四条 (low-resource priority)
 * and the release policy require that resource regressions be measured and
 * resolved or explicitly justified before progression. This harness measures
 * the platform-neutral core (CPU time per operation and heap delta) with
 * deterministic fixtures so runs are comparable across machines and commits.
 *
 * Scope: core-engine CPU/RAM only. Device dimensions (battery, wakeups,
 * background behavior, on-device memory pressure) require on-device
 * measurement and are explicitly out of scope here.
 */

export const RESOURCE_BENCHMARK_VERSION = 1;

function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, items) {
  return items[Math.floor(rand() * items.length)];
}

const HOSTS = ["us.example.com", "jp.example.com", "de.example.com", "sg.example.com"];
const PROTOCOLS = ["vless", "trojan", "ss", "hysteria2"];

function makeShareLinks(rand, count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    const protocol = pick(rand, PROTOCOLS);
    const host = pick(rand, HOSTS);
    const port = 1000 + Math.floor(rand() * 50000);
    const name = "node-" + i;
    if (protocol === "vless") lines.push("vless://user-" + i + "@" + host + ":" + port + "?security=tls#" + name);
    else if (protocol === "trojan") lines.push("trojan://pass-" + i + "@" + host + ":" + port + "#" + name);
    else if (protocol === "ss") lines.push("ss://" + Buffer.from("aes-128-gcm:pass-" + i).toString("base64") + "@" + host + ":" + port + "#" + name);
    else lines.push("hysteria2://pass-" + i + "@" + host + ":" + port + "#" + name);
  }
  return lines.join("\n");
}

function makeClashYaml(rand, count) {
  const lines = ["proxies:"];
  for (let i = 0; i < count; i++) {
    lines.push("  - name: node-" + i);
    lines.push("    type: socks5");
    lines.push("    server: " + pick(rand, HOSTS));
    lines.push("    port: " + (1000 + Math.floor(rand() * 50000)));
  }
  return lines.join("\n");
}

function makeCompiledConfigs(nodeCount) {
  const proxies = [];
  const outbounds = [];
  const xrayOutbounds = [];
  for (let i = 0; i < nodeCount; i++) {
    proxies.push({ name: "node-" + i, type: "socks", server: "us.example.com", port: 1080 + (i % 100) });
    outbounds.push({ tag: "node-" + i, type: "socks", server: "us.example.com", server_port: 1080 + (i % 100) });
    xrayOutbounds.push({ tag: "node-" + i, protocol: "socks", settings: { address: "us.example.com", port: 1080 + (i % 100) } });
  }
  const mihomo = { proxies, rules: ["MATCH,PROXY"] };
  const singbox = {
    outbounds: [...outbounds, { tag: "proxy", type: "selector", outbounds: outbounds.map((o) => o.tag) }],
    route: { final: "proxy", rules: [] },
  };
  const xray = {
    outbounds: xrayOutbounds,
    routing: { rules: [{ type: "field", outboundTag: xrayOutbounds[0].tag }] },
  };
  return { mihomo, singbox, xray };
}

function makeRules(rand, count) {
  const rules = [];
  const domains = ["google.com", "github.com", "example.org", "cdn.example.net"];
  for (let i = 0; i < count; i++) {
    const kind = i % 3;
    const match = kind === 0
      ? { domain_suffix: [pick(rand, domains)] }
      : kind === 1
        ? { package_name: ["com.example.app" + (i % 20)] }
        : { port: [80 + (i % 4000)] };
    rules.push({
      id: "rule-" + i,
      enabled: true,
      match,
      action: { type: i % 5 === 0 ? "bypass" : "route", target: i % 5 === 0 ? "direct" : "proxy" },
    });
  }
  return rules;
}

function makeFlows(ruleCount, flowCount) {
  const flows = [];
  for (let i = 0; i < flowCount; i++) {
    const kind = i % 3;
    flows.push(kind === 0
      ? { domain: "www.google.com" }
      : kind === 1
        ? { package_name: "com.example.app" + (i % 20) }
        : { port: 80 + (i % 4000) });
  }
  return flows;
}

function makeRoutingPolicy(ruleCount) {
  const rules = [];
  for (let i = 0; i < ruleCount; i++) {
    rules.push({
      id: "route-" + i,
      name: "Route " + i,
      match: { domain_suffix: ["example-" + i + ".com"] },
      action: { type: "route", target: "US" },
      order: i,
    });
  }
  return { mode: "rule", rules, strategies: [], defaultAction: { type: "route", target: "US" } };
}

function heapMB() {
  if (typeof globalThis.gc === "function") {
    try { globalThis.gc(); } catch { /* best effort */ }
  }
  return process.memoryUsage().heapUsed / 1048576;
}

function buildWorkloads(options) {
  const { seed, nodeCount, ruleCount, flowCount } = options;
  const rand = mulberry32(seed);
  const shareLinks = makeShareLinks(rand, nodeCount);
  const clashYaml = makeClashYaml(rand, nodeCount);
  const compiled = makeCompiledConfigs(nodeCount);
  const rules = makeRules(rand, ruleCount);
  const flows = makeFlows(ruleCount, flowCount);
  const routingPolicy = makeRoutingPolicy(ruleCount);

  return [
    {
      name: "sniff",
      run() {
        sniff(shareLinks);
        sniff(clashYaml);
      },
    },
    {
      name: "import",
      run() {
        importConfig(shareLinks);
        importConfig(clashYaml);
      },
    },
    {
      name: "validate",
      run() {
        const a = validateCompiledConfig(compiled.mihomo, Kernels.MIHOMO);
        const b = validateCompiledConfig(compiled.singbox, Kernels.SING_BOX);
        const c = validateCompiledConfig(compiled.xray, Kernels.XRAY);
        if (!a.ok || !b.ok || !c.ok) throw new Error("benchmark fixture failed validation");
      },
    },
    {
      name: "rule-match",
      run() {
        for (const flow of flows) evaluateParallelMatchSet(rules, flow);
      },
    },
    {
      name: "route-compile",
      run() {
        compileRoutingPolicy(routingPolicy, Kernels.MIHOMO);
        compileRoutingPolicy(routingPolicy, Kernels.SING_BOX);
        compileRoutingPolicy(routingPolicy, Kernels.XRAY);
      },
    },
  ];
}

function measureWorkload(workload, iterations, warmup, minDurationMs) {
  for (let i = 0; i < warmup; i++) workload.run();
  // Calibrate: fast operations need many more iterations for stable timing.
  // Never reduce below the requested iteration count.
  let ops = iterations;
  if (minDurationMs > 0) {
    const probeIters = Math.min(iterations, 20);
    const probeStart = process.hrtime.bigint();
    for (let i = 0; i < probeIters; i++) workload.run();
    const probeNs = Number(process.hrtime.bigint() - probeStart);
    if (probeNs > 0) {
      const need = Math.ceil((minDurationMs * 1e6) / (probeNs / probeIters));
      ops = Math.min(Math.max(ops, need), 1000000);
    }
  }
  const heapBefore = heapMB();
  const start = process.hrtime.bigint();
  for (let i = 0; i < ops; i++) workload.run();
  const end = process.hrtime.bigint();
  const heapAfter = heapMB();
  const totalNs = Number(end - start);
  return Object.freeze({
    name: workload.name,
    iterations: ops,
    warmup,
    totalNs,
    nsPerOp: totalNs / ops,
    opsPerSec: 1e9 / (totalNs / ops),
    heapBeforeMB: Math.round(heapBefore * 100) / 100,
    heapAfterMB: Math.round(heapAfter * 100) / 100,
    heapDeltaMB: Math.round((heapAfter - heapBefore) * 100) / 100,
  });
}

export function listBenchmarkWorkloads() {
  return Object.freeze(["sniff", "import", "validate", "rule-match", "route-compile"]);
}

export function runBenchmark({
  seed = 1,
  iterations = 200,
  warmup = 20,
  nodeCount = 50,
  ruleCount = 200,
  flowCount = 200,
  workloads = null,
  minDurationMs = 500,
} = {}) {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("iterations must be a positive integer");
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error("warmup must be a non-negative integer");
  if (!Number.isFinite(minDurationMs) || minDurationMs < 0) throw new Error("minDurationMs must be a non-negative number");
  const selected = workloads === null ? null : new Set(workloads);
  const results = [];
  let totalNs = 0;
  for (const workload of buildWorkloads({ seed, nodeCount, ruleCount, flowCount })) {
    if (selected && !selected.has(workload.name)) continue;
    const measured = measureWorkload(workload, iterations, warmup, minDurationMs);
    results.push(measured);
    totalNs += measured.totalNs;
  }
  if (results.length === 0) throw new Error("no workloads selected");
  return Object.freeze({
    benchmarkVersion: RESOURCE_BENCHMARK_VERSION,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    timestamp: new Date().toISOString(),
    seed,
    iterations,
    warmup,
    nodeCount,
    ruleCount,
    flowCount,
    minDurationMs,
    totalNs,
    workloads: Object.freeze(results),
  });
}

export function compareBenchmarks(baseline, current, maxRegression = 0.2) {
  if (!baseline || baseline.benchmarkVersion !== RESOURCE_BENCHMARK_VERSION) {
    throw new Error("incompatible baseline report version");
  }
  if (!current || current.benchmarkVersion !== RESOURCE_BENCHMARK_VERSION) {
    throw new Error("incompatible current report version");
  }
  const baseByName = new Map(baseline.workloads.map((w) => [w.name, w]));
  const regressions = [];
  const comparisons = [];
  for (const workload of current.workloads) {
    const base = baseByName.get(workload.name);
    if (!base) {
      comparisons.push(Object.freeze({ name: workload.name, status: "no-baseline" }));
      continue;
    }
    const delta = (workload.nsPerOp - base.nsPerOp) / base.nsPerOp;
    const regressed = delta > maxRegression;
    comparisons.push(Object.freeze({
      name: workload.name,
      status: regressed ? "regressed" : "ok",
      baselineNsPerOp: base.nsPerOp,
      currentNsPerOp: workload.nsPerOp,
      deltaRatio: Math.round(delta * 10000) / 10000,
    }));
    if (regressed) regressions.push(workload.name);
  }
  return Object.freeze({
    ok: regressions.length === 0,
    maxRegression,
    regressions: Object.freeze(regressions),
    comparisons: Object.freeze(comparisons),
  });
}
