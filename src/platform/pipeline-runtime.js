import { driverFor } from "../kernel/driver-registry.js";
import { createChainTopology } from "./chain-topology.js";
import { createChainHealthMonitor } from "./chain-health-monitor.js";
import { PROBE_TYPES } from "./chain-health.js";
import { createPipelineLinkPlan } from "./pipeline-linker.js";
import { compileLinkedPipeline } from "./pipeline-kernel-linker.js";

function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

function healthSpecFor(hop, overrides = {}) {
  const override = overrides[hop.id] || {};
  const endpoint = override.host
    ? override
    : (hop.node?.endpoint || {});
  const host = typeof endpoint.server === "string" ? endpoint.server : endpoint.host;
  const port = endpoint.port;
  if (!host || !Number.isInteger(port)) return null;
  return {
    hopId: hop.id,
    host,
    port,
    type: override.type || PROBE_TYPES.TCP,
    timeoutMs: override.timeoutMs || 3000,
  };
}

export function createPipelineRuntime({
  spec,
  drivers,
  runtimeOptions = {},
  healthProbe = null,
  healthSpecs = {},
  healthMonitorOptions = {},
} = {}) {
  if (!spec || !Array.isArray(spec.hops) || spec.hops.length === 0) {
    throw new TypeError("pipeline runtime requires a pipeline spec");
  }

  const driverLookup = typeof drivers === "function"
    ? drivers
    : (kernel) => (drivers && drivers[kernel]) || driverFor(kernel);

  const runtimes = new Map();
  const compiled = new Map();
  let started = false;

  function prepare() {
    for (const hop of spec.hops) {
      if (compiled.has(hop.id)) continue;
      const driver = driverLookup(hop.kernel);
      if (!driver) throw new Error("kernel driver is unavailable: " + hop.kernel);
      compiled.set(hop.id, Object.freeze({
        hopId: hop.id,
        kernel: hop.kernel,
        config: driver.compileNode(hop.node, { security: spec.security }),
        listen: hop.listen,
      }));
    }
    return Object.freeze([...compiled.values()]);
  }

  function createRuntimes() {
    for (const hop of spec.hops) {
      if (runtimes.has(hop.id)) continue;
      const driver = driverLookup(hop.kernel);
      if (!driver) throw new Error("kernel driver is unavailable: " + hop.kernel);
      const options = clone(runtimeOptions[hop.id] || runtimeOptions[hop.kernel] || {});
      runtimes.set(hop.id, driver.createRuntime(options));
    }
  }

  const monitor = healthProbe
    ? createChainHealthMonitor({ probe: healthProbe, ...healthMonitorOptions })
    : null;

  function configureHealth() {
    if (!monitor) return;
    for (const hop of spec.hops) {
      const healthSpec = healthSpecFor(hop, healthSpecs);
      if (healthSpec) monitor.addHop(healthSpec);
    }
  }

  async function start() {
    if (started) throw new Error("pipeline runtime already running");
    prepare();
    createRuntimes();
    const startedHops = [];
    try {
      for (const hop of spec.hops) {
        await runtimes.get(hop.id).start();
        startedHops.push(hop.id);
      }
      started = true;
      configureHealth();
      if (monitor) await monitor.start();
      return await status();
    } catch (error) {
      if (monitor) await monitor.stop();
      for (const hopId of startedHops.reverse()) {
        try { await runtimes.get(hopId).stop(); } catch {}
      }
      started = false;
      throw error;
    }
  }

  async function stop() {
    if (monitor) await monitor.stop();
    const errors = [];
    for (const hop of [...spec.hops].reverse()) {
      const runtime = runtimes.get(hop.id);
      if (!runtime) continue;
      try { await runtime.stop(); } catch (error) { errors.push(error); }
    }
    started = false;
    if (errors.length) throw errors[0];
  }

  async function status() {
    const hops = [];
    for (const hop of spec.hops) {
      const runtime = runtimes.get(hop.id);
      const process = runtime && typeof runtime.status === "function" ? await runtime.status() : null;
      hops.push(Object.freeze({
        hopId: hop.id,
        kernel: hop.kernel,
        running: process ? process.running === true : false,
        pid: process ? process.pid : null,
        listen: hop.listen,
      }));
    }
    return Object.freeze({
      pipelineId: spec.id,
      running: started && hops.every((hop) => hop.running),
      hops: Object.freeze(hops),
    });
  }

  async function reload(hopId, config) {
    const runtime = runtimes.get(hopId);
    if (!runtime || typeof runtime.reload !== "function") {
      throw new Error("kernel runtime does not support reload: " + hopId);
    }
    return runtime.reload(config);
  }

  function linkPlan() {
    return createPipelineLinkPlan(spec);
  }

  function compileLinked() {
    return compileLinkedPipeline(spec, { drivers: driverLookup });
  }

  function topology() {
    const health = {};
    if (monitor) {
      for (const item of monitor.getSnapshot()) health[item.hopId] = item;
    }
    return createChainTopology(spec, health);
  }

  return Object.freeze({
    spec,
    prepare,
    start,
    stop,
    status,
    reload,
    linkPlan,
    compileLinked,
    topology,
    health: monitor,
    isRunning() { return started; },
  });
}
