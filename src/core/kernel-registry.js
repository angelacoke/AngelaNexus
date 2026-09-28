export const UpstreamKernelRegistry = Object.freeze({
  mihomo: Object.freeze({
    name: "Mihomo",
    repository: "MetaCubeX/mihomo",
    stable: "1.19.31",
    channel: "stable",
    preview: null,
    releases: "https://github.com/MetaCubeX/mihomo/releases",
    docs: "https://wiki.metacubex.one/en/config/proxies/"
  }),
  "sing-box": Object.freeze({
    name: "sing-box",
    repository: "SagerNet/sing-box",
    stable: "1.14.2",
    channel: "stable",
    preview: "1.15.0-alpha.6",
    releases: "https://github.com/SagerNet/sing-box/releases",
    docs: "https://sing-box.sagernet.org/configuration/outbound/"
  }),
  xray: Object.freeze({
    name: "Xray-core",
    repository: "XTLS/Xray-core",
    stable: "26.9.8",
    channel: "stable",
    preview: "26.9.9",
    releases: "https://github.com/XTLS/Xray-core/releases",
    docs: "https://xtls.github.io/en/config/outbounds/"
  })
});

export const UpstreamKernelNames = Object.freeze(Object.keys(UpstreamKernelRegistry));

export const KernelUpdatePolicy = Object.freeze({
  automaticDiscovery: true,
  automaticCandidatePreparation: true,
  automaticUpgrade: false,
  automaticRuntimeActivation: false,
  automaticMerge: false,
  notifyAvailableUpdate: true,
  requireReleaseVerification: true,
  requireAdapterImpactReview: true,
  requireCompatibilityTests: true,
  requireRuntimeConformance: true,
  requireSecurityReview: true,
  requireUserApproval: true,
  preservePreviousStable: true
});

export function getKernelUpstream(kernel) {
  const entry = UpstreamKernelRegistry[kernel];
  if (!entry) throw new Error("unsupported kernel: " + kernel);
  return entry;
}

export function getKernelUpdatePolicy() {
  return KernelUpdatePolicy;
}
