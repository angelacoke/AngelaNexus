import { Kernels } from "./model.js";
import { UpstreamKernelRegistry } from "./kernel-registry.js";
import { KernelCapabilityManifest } from "./kernel-capability-manifest.js";
import { validateNodeCombinations } from "./combination-constraints.js";
import { validateKernelFeatures } from "./kernel-feature-manifest.js";

export const CompatibilityStatus = Object.freeze({
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown"
});

export const KernelVersions = Object.freeze(Object.fromEntries(
  Object.entries(UpstreamKernelRegistry).map(([kernel, entry]) => [kernel, Object.freeze({
    stable: entry.stable,
    channel: entry.channel,
    ...(entry.preview ? { preview: entry.preview } : {})
  })])
));

const EVIDENCE = Object.freeze(Object.fromEntries(
  Object.entries(UpstreamKernelRegistry).map(([kernel, entry]) => [kernel, entry.docs])
));

function normalizeProtocol(protocol) {
  const value = String(protocol || "").trim().toLowerCase();
  if (value === "ss") return "shadowsocks";
  if (value === "socks5") return "socks";
  if (value === "hy2") return "hysteria2";
  return value;
}

export function protocolCompatibility(kernel, protocol) {
  if (!Object.values(Kernels).includes(kernel)) throw new Error("unsupported kernel: " + kernel);
  const normalized = normalizeProtocol(protocol);
  const manifest = KernelCapabilityManifest[kernel];
  const base = { kernel, protocol: normalized || null, evidence: EVIDENCE[kernel], version: KernelVersions[kernel] };

  if (!normalized) return { ...base, status: CompatibilityStatus.UNKNOWN, reason: "node protocol is missing" };
  if (manifest.unsupported.includes(normalized)) {
    return { ...base, status: CompatibilityStatus.UNSUPPORTED, reason: "upstream kernel does not expose this outbound protocol" };
  }
  if (manifest.protocols.includes(normalized)) {
    return { ...base, status: CompatibilityStatus.SUPPORTED, reason: "verified in the maintained upstream capability manifest" };
  }
  return { ...base, status: CompatibilityStatus.UNKNOWN, reason: "not established by the maintained compatibility manifest" };
}

export function validateUnifiedCompatibility(config, kernel = config && config.kernel) {
  if (!config || typeof config !== "object") throw new TypeError("unified configuration is required");
  if (!Object.values(Kernels).includes(kernel)) throw new Error("unsupported kernel: " + kernel);

  const nodes = Array.isArray(config.nodes) ? config.nodes : [];
  const results = nodes.map((node) => ({
    id: node.id || node.name || null,
    ...protocolCompatibility(kernel, node.protocol || node.type)
  }));
  const unknown = results.filter((item) => item.status === CompatibilityStatus.UNKNOWN);
  const unsupported = results.filter((item) => item.status === CompatibilityStatus.UNSUPPORTED);

  const combination = validateNodeCombinations(kernel, nodes);
  const constraintErrors = combination.errors;
  const warnings = combination.warnings;
  const features = validateKernelFeatures(kernel, nodes);

  return {
    kernel,
    version: KernelVersions[kernel],
    ok: unsupported.length === 0 && unknown.length === 0 &&
      constraintErrors.length === 0 && features.errors.length === 0 && features.unknown.length === 0,
    status: unsupported.length || constraintErrors.length || features.errors.length
      ? CompatibilityStatus.UNSUPPORTED
      : (unknown.length || features.unknown.length ? CompatibilityStatus.UNKNOWN : CompatibilityStatus.SUPPORTED),
    nodes: results,
    unsupported,
    unknown,
    constraintErrors,
    warnings,
    featureErrors: features.errors,
    featureUnknown: features.unknown,
    featureResults: features.results
  };
}

export function buildCompatibilityMatrix(protocols = [
  "http", "socks", "shadowsocks", "vmess", "vless", "trojan",
  "wireguard", "hysteria", "hysteria2", "tuic", "anytls"
]) {
  return [...new Set(protocols.map(normalizeProtocol).filter(Boolean))].map((protocol) => {
    const row = { protocol };
    for (const kernel of Object.values(Kernels)) row[kernel] = protocolCompatibility(kernel, protocol);
    return row;
  });
}
