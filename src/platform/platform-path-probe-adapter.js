import { createPlatformContract, PlatformCapabilities } from "./contract.js";
import { createPathProbeExecutor } from "./path-probe-executor.js";
import { createNativePathProbeDriver } from "./native-path-probe-driver.js";

export const PLATFORM_PATH_PROBE_ADAPTER_VERSION = 2;

export function createPlatformPathProbeAdapter(platformImplementation, { mode = null } = {}) {
  const contract = createPlatformContract(platformImplementation);
  const supportsProbe = contract.capabilities.includes(PlatformCapabilities.PATH_PROBE);
  const driver = createNativePathProbeDriver(contract, { mode });

  if (!supportsProbe || !driver.supported) {
    return Object.freeze({
      version: PLATFORM_PATH_PROBE_ADAPTER_VERSION,
      platform: contract.platform,
      mode: driver.mode,
      supported: false,
      reason: !supportsProbe ? "capability-unavailable" : driver.reason,
      driver,
      executor: null,
    });
  }

  const executor = createPathProbeExecutor({
    platform: contract.platform,
    capabilities: contract.capabilities,
    probe: driver.probe,
  });

  return Object.freeze({
    version: PLATFORM_PATH_PROBE_ADAPTER_VERSION,
    platform: contract.platform,
    mode: driver.mode,
    supported: true,
    reason: "ready",
    driver,
    executor,
  });
}
