import { PlatformId, createPlatformContract } from "./contract.js";
import { createAndroidNativeTransparentBinding } from "./android-native-transparent-binding.js";

export const ANDROID_TRANSPARENT_RUNTIME_FACTORY_VERSION = 1;

export function createAndroidTransparentRuntimeFactory(
  implementation,
  { mode = null, runtime = {} } = {},
) {
  const contract = createPlatformContract(implementation);
  if (contract.platform !== PlatformId.ANDROID) {
    throw new TypeError("Android transparent runtime requires android platform");
  }

  const binding = createAndroidNativeTransparentBinding({
    runtime,
    requestedMode: mode || "auto",
    probePath: contract.probePath,
  });

  return Object.freeze({
    version: ANDROID_TRANSPARENT_RUNTIME_FACTORY_VERSION,
    platform: contract.platform,
    mode: binding.mode,
    supported: binding.supported,
    reason: binding.reason,
    binding,
  });
}
