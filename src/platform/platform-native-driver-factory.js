import { PlatformId, PlatformCapabilities, createPlatformContract } from "./contract.js";
import { createNativePathDriverBinding, inspectNativePathDriver } from "./platform-native-path-drivers.js";
import { createPlatformPathProbeAdapter } from "./platform-path-probe-adapter.js";

export const PLATFORM_NATIVE_DRIVER_FACTORY_VERSION = 1;

function requiredCapabilitiesFor(platform) {
  const common = [PlatformCapabilities.PATH_PROBE];
  if (platform === PlatformId.ANDROID || platform === PlatformId.LINUX) {
    return Object.freeze(common);
  }
  return Object.freeze(common);
}

export function inspectPlatformNativeDriver(platform, { mode = null } = {}) {
  const profile = inspectNativePathDriver(platform, { mode });
  return Object.freeze({
    version: PLATFORM_NATIVE_DRIVER_FACTORY_VERSION,
    ...profile,
    requiredCapabilities: requiredCapabilitiesFor(platform),
  });
}

export function createPlatformNativeDriverFactory(implementation, { mode = null } = {}) {
  const contract = createPlatformContract(implementation);
  const profile = inspectPlatformNativeDriver(contract.platform, { mode });
  const binding = createNativePathDriverBinding(contract, { mode });
  const adapter = binding.supported
    ? createPlatformPathProbeAdapter(contract, { mode })
    : null;

  return Object.freeze({
    version: PLATFORM_NATIVE_DRIVER_FACTORY_VERSION,
    platform: contract.platform,
    mode: profile.mode,
    driverId: profile.id,
    nativeBoundary: profile.nativeBoundary,
    supported: binding.supported && adapter?.supported === true,
    reason: !binding.supported ? binding.reason : adapter?.reason || "adapter-unavailable",
    binding,
    adapter,
  });
}
