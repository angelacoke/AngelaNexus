import { Kernels } from "../core/model.js";
import { adapterFor } from "../adapters/index.js";
import { driverFor } from "./driver-registry.js";
import { KernelDriverCapabilities } from "./driver-contract.js";
import { getKernelRuntimeSpec } from "./runtime-registry.js";
import { getKernelUpstream } from "../core/kernel-registry.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const KERNEL_SYNCHRONIZATION_VERSION = 1;

export const REQUIRED_KERNELS = Object.freeze([
  Kernels.MIHOMO,
  Kernels.SING_BOX,
  Kernels.XRAY,
]);

export const KERNEL_SYNC_REQUIREMENTS = Object.freeze({
  configCompile: true,
  chainCompile: true,
  processRuntime: true,
  capabilityDeclaration: true,
  conformanceVerification: true,
});

function inspectKernel(kernel) {
  const adapter = adapterFor(kernel);
  const driver = driverFor(kernel);
  const runtime = getKernelRuntimeSpec(kernel);
  const upstream = getKernelUpstream(kernel);
  const conformanceScript = resolve(process.cwd(), "scripts/kernel-conformance.mjs");
  return Object.freeze({
    kernel,
    upstreamStable: Boolean(upstream?.stable),
    upstreamRepository: Boolean(upstream?.repository),
    conformanceScript: existsSync(conformanceScript),
    adapter: Boolean(adapter),
    driver: Boolean(driver),
    capabilities: Object.freeze(driver ? [...driver.capabilities] : []),
    runtime: Object.freeze({ ...runtime }),
    runtimeDeclared: Boolean(runtime && Object.prototype.hasOwnProperty.call(runtime, "reloadSignal")),
    configCompile: Boolean(adapter?.compileConfig),
    chainCompile: Boolean(adapter?.compileChain),
  });
}

export function inspectKernelSynchronization() {
  const kernels = REQUIRED_KERNELS.map(inspectKernel);
  const missing = [];
  for (const item of kernels) {
    if (!item.upstreamStable) missing.push(item.kernel + ":upstream-stable");
    if (!item.upstreamRepository) missing.push(item.kernel + ":upstream-repository");
    if (!item.conformanceScript) missing.push(item.kernel + ":conformance-script");
    if (!item.adapter) missing.push(item.kernel + ":adapter");
    if (!item.driver) missing.push(item.kernel + ":driver");
    if (!item.configCompile) missing.push(item.kernel + ":config-compile");
    if (!item.chainCompile) missing.push(item.kernel + ":chain-compile");
    if (!item.capabilities.includes(KernelDriverCapabilities.NODE_COMPILE)) missing.push(item.kernel + ":node-compile");
    if (!item.capabilities.includes(KernelDriverCapabilities.PIPELINE_COMPILE)) missing.push(item.kernel + ":pipeline-compile");
    if (!item.capabilities.includes(KernelDriverCapabilities.PROCESS_RUNTIME)) missing.push(item.kernel + ":process-runtime");
    if (!item.runtimeDeclared) missing.push(item.kernel + ":runtime-spec");
    if (item.runtime?.reloadSignal === undefined) missing.push(item.kernel + ":reload-signal");
  }
  return Object.freeze({
    version: KERNEL_SYNCHRONIZATION_VERSION,
    ok: missing.length === 0,
    requiredKernels: REQUIRED_KERNELS,
    kernels: Object.freeze(kernels),
    missing: Object.freeze(missing),
    requirements: KERNEL_SYNC_REQUIREMENTS,
  });
}

export function requireKernelSynchronization() {
  const report = inspectKernelSynchronization();
  if (!report.ok) throw new Error("kernel synchronization incomplete: " + report.missing.join(", "));
  return report;
}
