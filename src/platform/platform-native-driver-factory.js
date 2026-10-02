import { PlatformId, PlatformCapabilities, createPlatformContract } from "./contract.js";
import { createNativePathDriverBinding, inspectNativePathDriver } from "./platform-native-path-drivers.js";
import { createPlatformPathProbeAdapter } from "./platform-path-probe-adapter.js";
import { createAndroidNativeTransparentBinding } from "./android-native-transparent-binding.js";

export const PLATFORM_NATIVE_DRIVER_FACTORY_VERSION = 2;

function requiredCapabilitiesFor(platform) {
  return Object.freeze([PlatformCapabilities.PATH_PROBE]);
}

export function inspectPlatformNativeDriver(platform, { mode = null } = {}) {
  const profile = inspectNativePathDriver(platform, { mode });
  return Object.freeze({
    version: PLATFORM_NATIVE_DRIVER_FACTORY_VERSION,
    ...profile,
    requiredCapabilities: requiredCapabilitiesFor(platform),
  });
}

export function createPlatformNativeDriverFactory(implementation, {
  mode = null,
  androidTransparentRuntime = null,
} = {}) {
  const contract = createPlatformContract(implementation);
  const profile = inspectPlatformNativeDriver(contract.platform, { mode });
  const binding = createNativePathDriverBinding(contract, { mode });
  const adapter = binding.supported
    ? createPlatformPathProbeAdapter(contract, { mode })
    : null;

  const transparentBinding = contract.platform === PlatformId.ANDROID && androidTransparentRuntime
    ? createAndroidNativeTransparentBinding({
        runtime: androidTransparentRuntime,
        requestedMode: mode || "auto",
        probePath: implementation.probePath,
      })
    : null;

  const supported = binding.supported &&
    adapter?.supported === true &&
    (transparentBinding === null || transparentBinding.supported === true);

  return Object.freeze({
    version: PLATFORM_NATIVE_DRIVER_FACTORY_VERSION,
    platform: contract.platform,
    mode: transparentBinding?.mode || profile.mode,
    driverId: profile.id,
    nativeBoundary: profile.nativeBoundary,
    supported,
    reason: !binding.supported
      ? binding.reason
      : adapter?.supported !== true
        ? adapter?.reason || "adapter-unavailable"
        : transparentBinding?.supported === false
          ? transparentBinding.reason
          : "ready",
    binding,
    adapter,
    transparentBinding,
  });
}
