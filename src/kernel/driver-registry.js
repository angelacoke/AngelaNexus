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

  const nativePlatforms = kernel === Kernels.MIHOMO ? new Set(["android"]) : new Set();

  return createKernelDriver({
    id: kernel,
    kernel,
    capabilities: [
      KernelDriverCapabilities.NODE_COMPILE,
      KernelDriverCapabilities.PIPELINE_COMPILE,
      KernelDriverCapabilities.PROCESS_RUNTIME,
      ...(nativePlatforms.size ? [KernelDriverCapabilities.NATIVE_RUNTIME] : []),
    ],
    adapter,
    canExecute(plan) {
      return (plan?.kernel == null || plan.kernel === kernel) && plan?.protocol?.id != null;
    },
    match(plan) {
      const runtime = plan?.runtime;
      if (!runtime || runtime.selectedMode !== "native") return { preference: "compatible", reason: "process runtime or unspecified runtime" };
      if (!nativePlatforms.has(String(runtime.platform || "").toLowerCase())) {
        return { compatible: false, reason: "native runtime is not implemented for this kernel/platform" };
      }
      return { preference: "native-runtime", reason: "registered native runtime capability matches the selected platform" };
    },
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
      if (options.runtimeMode === "native") {
        if (!nativePlatforms.has(String(options.platform || "").toLowerCase())) {
          throw new Error("native runtime is not implemented for kernel/platform: " + kernel + "/" + options.platform);
        }
        if (typeof options.nativeRuntimeFactory !== "function") {
          throw new Error("native runtime selected but nativeRuntimeFactory is unavailable");
        }
        return options.nativeRuntimeFactory(kernel, options);
      }
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
