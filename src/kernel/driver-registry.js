import { Kernels } from "../core/model.js";
import { adapterFor } from "../adapters/index.js";
import { createKernelRuntime } from "./runtime-registry.js";
import { createKernelDriver, KernelDriverCapabilities } from "./driver-contract.js";
import { compileUnifiedConfig } from "../core/config-compiler.js";

function compileSingleNode(node, kernel, extra = {}) {
  const result = compileUnifiedConfig({
    kernel,
    nodes: [node.source || node],
    security: { failClosed: true, ...(extra.security || {}) },
  }, kernel);
  return result.config;
}

function createDriver(kernel) {
  const adapter = adapterFor(kernel);
  if (!adapter) throw new Error("kernel adapter is unavailable: " + kernel);

  return createKernelDriver({
    kernel,
    capabilities: [
      KernelDriverCapabilities.NODE_COMPILE,
      KernelDriverCapabilities.PIPELINE_COMPILE,
      KernelDriverCapabilities.PROCESS_RUNTIME,
    ],
    adapter,
    compileNode(node, context = {}) {
      return compileSingleNode(node, kernel, context);
    },
    compilePipeline(spec, context = {}) {
      if (!spec || !Array.isArray(spec.hops) || spec.hops.length === 0) {
        throw new TypeError("pipeline spec must contain at least one hop");
      }
      const selected = spec.hops.filter((hop) => hop.kernel === kernel);
      if (!selected.length) {
        throw new Error("pipeline does not contain a hop for kernel: " + kernel);
      }
      return Object.freeze({
        kernel,
        config: compileSingleNode(selected[0].node, kernel, context),
        listen: selected[0].listen,
        hopId: selected[0].id,
        upstream: selected.length > 1 ? selected.slice(1).map((hop) => hop.id) : [],
      });
    },
    createRuntime(options = {}) {
      return createKernelRuntime(kernel, options);
    },
  });
}

export const kernelDrivers = Object.freeze({
  [Kernels.MIHOMO]: createDriver(Kernels.MIHOMO),
  [Kernels.SING_BOX]: createDriver(Kernels.SING_BOX),
  [Kernels.XRAY]: createDriver(Kernels.XRAY),
});

export function driverFor(kernel) {
  return kernelDrivers[kernel] || null;
}

export function describeKernelDrivers() {
  return Object.values(Kernels).map((kernel) => {
    const driver = driverFor(kernel);
    return Object.freeze({
      kernel,
      capabilities: Object.freeze([...driver.capabilities]),
    });
  });
}
