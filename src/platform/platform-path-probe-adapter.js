import { createPlatformContract, PlatformCapabilities } from "./contract.js";
import { createPathProbeExecutor } from "./path-probe-executor.js";

export const PLATFORM_PATH_PROBE_ADAPTER_VERSION = 1;

export function createPlatformPathProbeAdapter(platformImplementation) {
  const contract = createPlatformContract(platformImplementation);
  const supportsProbe = contract.capabilities.includes(PlatformCapabilities.PATH_PROBE);

  if (!supportsProbe) {
    return Object.freeze({
      version: PLATFORM_PATH_PROBE_ADAPTER_VERSION,
      platform: contract.platform,
      supported: false,
      reason: "capability-unavailable",
      executor: null,
    });
  }

  const executor = createPathProbeExecutor({
    platform: contract.platform,
    capabilities: contract.capabilities,
    probe: contract.probePath,
  });

  return Object.freeze({
    version: PLATFORM_PATH_PROBE_ADAPTER_VERSION,
    platform: contract.platform,
    supported: true,
    reason: "ready",
    executor,
  });
}
