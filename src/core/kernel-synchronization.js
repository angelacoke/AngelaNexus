import { adapterFor, hasAdapterCapability, AdapterCapabilities } from "../adapters/index.js";
import { Kernels } from "./model.js";
import { getKernelUpstream, UpstreamKernelNames } from "./kernel-registry.js";

export const KERNEL_SYNCHRONIZATION_VERSION = 1;

export const REQUIRED_KERNELS = Object.freeze([
  Kernels.MIHOMO,
  Kernels.SING_BOX,
  Kernels.XRAY
]);

export const REQUIRED_SYNCHRONIZATION_CAPABILITIES = Object.freeze([
  AdapterCapabilities.CONFIG_COMPILE,
  AdapterCapabilities.CHAIN_COMPILE
]);

export const REQUIRED_CONFORMANCE_FIELDS = Object.freeze([
  "fixtures",
  "capabilityProbes"
]);

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
}

function inspectKernel(kernel) {
  const upstream = getKernelUpstream(kernel);
  const adapter = adapterFor(kernel);
  const missing = [];

  if (!adapter) missing.push("adapter");
  for (const capability of REQUIRED_SYNCHRONIZATION_CAPABILITIES) {
    if (!hasAdapterCapability(adapter, capability)) missing.push("adapter:" + capability);
  }

  for (const field of REQUIRED_CONFORMANCE_FIELDS) {
    const value = upstream?.conformance?.[field];
    if (field === "fixtures" && !Array.isArray(value)) missing.push("conformance:fixtures");
    if (field === "capabilityProbes" || !value || typeof value !== "object") {
      if (field === "capabilityProbes" && (!value || typeof value !== "object" || Array.isArray(value))) {
        missing.push("conformance:capabilityProbes");
      }
    }
  }

  const fixtures = uniqueStrings(upstream?.conformance?.fixtures);
  if (fixtures.length === 0) missing.push("conformance:fixtures:empty");

  const capabilityProbes = upstream?.conformance?.capabilityProbes || {};
  if (Object.keys(capabilityProbes).length === 0) missing.push("conformance:capabilityProbes:empty");

  return Object.freeze({
    kernel,
    name: upstream.name,
    upstream: Object.freeze({
      repository: upstream.repository,
      stable: upstream.stable,
      channel: upstream.channel,
      preview: upstream.preview
    }),
    adapter: adapter
      ? Object.freeze({
          capabilities: Object.freeze([...adapter.capabilities]),
          chainMechanism: adapter.chainMechanism || null
        })
      : null,
    conformance: Object.freeze({
      fixtures: Object.freeze(fixtures),
      capabilityProbes: Object.freeze({ ...capabilityProbes })
    }),
    ok: missing.length === 0,
    missing: Object.freeze(missing)
  });
}

export function inspectKernelSynchronization() {
  const registryNames = new Set(UpstreamKernelNames);
  const requiredNames = new Set(REQUIRED_KERNELS);
  const kernels = REQUIRED_KERNELS.map(inspectKernel);
  const registryComplete = REQUIRED_KERNELS.every(kernel => registryNames.has(kernel));
  const noUnexpectedRequiredDrift = registryNames.size >= requiredNames.size;

  return Object.freeze({
    version: KERNEL_SYNCHRONIZATION_VERSION,
    requiredKernels: REQUIRED_KERNELS,
    registryKernels: Object.freeze([...UpstreamKernelNames]),
    kernels: Object.freeze(kernels),
    registryComplete,
    noUnexpectedRequiredDrift,
    ok: registryComplete && noUnexpectedRequiredDrift && kernels.every(item => item.ok)
  });
}

export function assertKernelSynchronization() {
  const report = inspectKernelSynchronization();
  if (!report.ok) {
    const details = report.kernels
      .filter(item => !item.ok)
      .map(item => item.kernel + ": " + item.missing.join(", "))
      .join("; ");
    const error = new Error("kernel synchronization gate failed" + (details ? ": " + details : ""));
    error.code = "NEXUS_KERNEL_SYNCHRONIZATION_FAILED";
    error.report = report;
    throw error;
  }
  return report;
}

export function getKernelSynchronizationVersion() {
  return KERNEL_SYNCHRONIZATION_VERSION;
}
