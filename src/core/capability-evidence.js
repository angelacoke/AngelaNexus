import { Kernels } from "./model.js";
import { getKernelUpstream } from "./kernel-registry.js";

const EVIDENCE = Object.freeze({
  [Kernels.MIHOMO]: Object.freeze({
    protocols: Object.freeze({
      source: "https://wiki.metacubex.one/en/config/proxies/",
      scope: "proxy configuration and common protocol capabilities"
    }),
    features: Object.freeze({
      source: "https://wiki.metacubex.one/en/config/proxies/transport/",
      scope: "transport and proxy feature configuration"
    })
  }),
  [Kernels.SING_BOX]: Object.freeze({
    protocols: Object.freeze({
      source: "https://sing-box.sagernet.org/configuration/outbound/",
      scope: "outbound type registry"
    }),
    features: Object.freeze({
      source: "https://sing-box.sagernet.org/configuration/outbound/",
      scope: "outbound and dial-field capability definitions"
    })
  }),
  [Kernels.XRAY]: Object.freeze({
    protocols: Object.freeze({
      source: "https://xtls.github.io/en/config/outbounds/",
      scope: "outbound protocol registry"
    }),
    features: Object.freeze({
      source: "https://xtls.github.io/en/config/",
      scope: "configuration and transport capability documentation"
    })
  })
});

export function getKernelCapabilityEvidence(kernel) {
  const evidence = EVIDENCE[kernel];
  if (!evidence) throw new Error("unsupported kernel: " + kernel);
  return Object.freeze({
    kernel,
    version: getKernelUpstream(kernel).stable,
    protocols: Object.freeze({ ...evidence.protocols }),
    features: Object.freeze({ ...evidence.features })
  });
}

export function getAllKernelCapabilityEvidence() {
  return Object.values(Kernels).map(getKernelCapabilityEvidence);
}
