import { PlatformCapabilities, PlatformId, createPlatformContract } from "./contract.js";
import { createPlatformPathProbeAdapter } from "./platform-path-probe-adapter.js";

export const PLATFORM_PATH_PROBE_PROFILES = Object.freeze({
  [PlatformId.ANDROID]: Object.freeze({
    platform: PlatformId.ANDROID,
    modes: Object.freeze(["non-root", "root"]),
  }),
  [PlatformId.LINUX]: Object.freeze({
    platform: PlatformId.LINUX,
    modes: Object.freeze(["native", "root"]),
  }),
  [PlatformId.WINDOWS]: Object.freeze({
    platform: PlatformId.WINDOWS,
    modes: Object.freeze(["native"]),
  }),
  [PlatformId.MACOS]: Object.freeze({
    platform: PlatformId.MACOS,
    modes: Object.freeze(["native"]),
  }),
  [PlatformId.IOS]: Object.freeze({
    platform: PlatformId.IOS,
    modes: Object.freeze(["native"]),
  }),
});

function normalizeMode(platform, mode) {
  const profile = PLATFORM_PATH_PROBE_PROFILES[platform];
  if (!profile) throw new TypeError("unsupported platform: " + platform);
  return profile.modes.includes(mode) ? mode : profile.modes[0];
}

export function createPlatformPathProbeBinding(implementation, { mode = null } = {}) {
  const contract = createPlatformContract(implementation);
  if (!contract.capabilities.includes(PlatformCapabilities.PATH_PROBE)) {
    return Object.freeze({
      platform: contract.platform,
      mode: normalizeMode(contract.platform, mode),
      supported: false,
      reason: "capability-unavailable",
      adapter: createPlatformPathProbeAdapter(contract),
    });
  }

  const selectedMode = normalizeMode(contract.platform, mode);
  return Object.freeze({
    platform: contract.platform,
    mode: selectedMode,
    supported: true,
    reason: "native-capability-declared",
    adapter: createPlatformPathProbeAdapter(contract),
  });
}

export function inspectPlatformPathProbeCapability(implementation) {
  const contract = createPlatformContract(implementation);
  return Object.freeze({
    platform: contract.platform,
    pathProbe: contract.capabilities.includes(PlatformCapabilities.PATH_PROBE),
    declaredCapabilities: contract.capabilities,
  });
}
