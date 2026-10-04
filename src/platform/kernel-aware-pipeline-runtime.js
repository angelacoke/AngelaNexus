import { createKernelAwarePipelinePlan } from "../core/pipeline-kernel-plan.js";
import { createPipelineRuntime } from "./pipeline-runtime.js";
import { createPipelineSpec } from "./pipeline-spec.js";

function endpoint(value, field) {
  if (!value || typeof value !== "object") throw new TypeError(field + " is required");
  const host = typeof value.host === "string" ? value.host.trim() : "";
  if (!host) throw new Error(field + ".host is required");
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw new RangeError(field + ".port is invalid");
  }
  return { host, port: value.port };
}

function resolveEndpoint(resolver, id, index) {
  if (typeof resolver === "function") return resolver(id, index);
  if (resolver && typeof resolver === "object") return resolver[id] || null;
  return null;
}

/**
 * Bridges the core deterministic kernel plan into the existing platform
 * pipeline runtime. Kernel choice is made once by the shared capability
 * registry + driver scheduler and then materialized into the platform spec.
 */
export function createKernelAwarePipelineRuntime(input = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("kernel-aware pipeline runtime input is required");
  }

  const kernelPlan = createKernelAwarePipelinePlan(input);
  if (!kernelPlan.ok) {
    throw new Error("pipeline kernel selection failed: " + kernelPlan.reason);
  }

  if (kernelPlan.spec.mode === "direct" || kernelPlan.spec.mode === "reject") {
    return Object.freeze({
      kernelPlan,
      runtime: null,
      spec: null,
      start: async () => {
        throw new Error("direct/reject pipeline modes do not create a kernel runtime");
      },
    });
  }

  const listenResolver = input.listenResolver || input.listens;
  if (!listenResolver) {
    throw new Error("kernel-aware pipeline runtime requires listenResolver");
  }

  const hops = kernelPlan.hops.map((plannedHop) => {
    const node = typeof input.nodeResolver === "function"
      ? input.nodeResolver(plannedHop.id, plannedHop.index)
      : input.nodes?.[plannedHop.id];

    if (!node) throw new Error("pipeline node cannot be resolved: " + plannedHop.id);

    const listen = endpoint(
      resolveEndpoint(listenResolver, plannedHop.id, plannedHop.index),
      "pipeline hop " + plannedHop.id + " listen",
    );

    return {
      id: plannedHop.id,
      kernel: plannedHop.kernel,
      node,
      listen,
    };
  });

  const platformSpec = createPipelineSpec({
    id: input.id || input.pipeline?.id || "pipeline",
    hops,
    inbound: input.inbound ? endpoint(input.inbound, "pipeline inbound") : null,
    security: input.security || {},
    resources: input.resources || {},
  });

  const runtime = createPipelineRuntime({
    spec: platformSpec,
    drivers: input.drivers,
    runtimeOptions: input.runtimeOptions,
    healthProbe: input.healthProbe,
    healthSpecs: input.healthSpecs,
    healthMonitorOptions: input.healthMonitorOptions,
  });

  return Object.freeze({
    kernelPlan,
    spec: platformSpec,
    runtime,
    prepare: runtime.prepare,
    start: runtime.start,
    stop: runtime.stop,
    status: runtime.status,
    reload: runtime.reload,
    linkPlan: runtime.linkPlan,
    compileLinked: runtime.compileLinked,
    topology: runtime.topology,
    health: runtime.health,
    isRunning: runtime.isRunning,
  });
}
