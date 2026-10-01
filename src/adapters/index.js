import { Kernels } from "../core/model.js";
import { createKernelAdapter, AdapterCapabilities, hasAdapterCapability } from "./contract.js";
import { compileMihomoConfig, compileMihomoChain } from "./mihomo/compiler.js";
import { compileSingBoxConfig, compileSingBoxChain } from "./sing-box/compiler.js";
import { compileXrayConfig, compileXrayChain } from "./xray/compiler.js";

export { AdapterCapabilities, createKernelAdapter, hasAdapterCapability };

export const adapters = Object.freeze({
  [Kernels.MIHOMO]: createKernelAdapter({
    kernel: Kernels.MIHOMO,
    capabilities: [AdapterCapabilities.CONFIG_COMPILE, AdapterCapabilities.CHAIN_COMPILE],
    chainMechanism: "dialer-proxy",
    compileConfig: compileMihomoConfig,
    compileChain: compileMihomoChain,
  }),
  [Kernels.SING_BOX]: createKernelAdapter({
    kernel: Kernels.SING_BOX,
    capabilities: [AdapterCapabilities.CONFIG_COMPILE, AdapterCapabilities.CHAIN_COMPILE],
    chainMechanism: "detour",
    compileConfig: compileSingBoxConfig,
    compileChain: compileSingBoxChain,
  }),
  [Kernels.XRAY]: createKernelAdapter({
    kernel: Kernels.XRAY,
    capabilities: [AdapterCapabilities.CONFIG_COMPILE, AdapterCapabilities.CHAIN_COMPILE],
    chainMechanism: "streamSettings.sockopt.dialerProxy",
    compileConfig: compileXrayConfig,
    compileChain: compileXrayChain,
  }),
});

export function adapterFor(kernel) {
  return adapters[kernel] || null;
}

export { builtinProtocolAdapters, builtinProtocolAdapterFor } from "./protocol-registry.js";
