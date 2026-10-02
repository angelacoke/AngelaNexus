export const PLATFORM_NATIVE_PATH_DRIVER_VERSION = 1;

export const NativePathDriverIds = Object.freeze({
  ANDROID: "android-native-path",
  LINUX: "linux-native-path",
  WINDOWS: "windows-native-path",
  MACOS: "macos-native-path",
  IOS: "ios-native-path",
});

const DRIVER_PROFILES = Object.freeze({
  android: Object.freeze({
    id: NativePathDriverIds.ANDROID,
    platform: "android",
    modes: Object.freeze(["non-root", "root"]),
    nativeBoundary: "platform-bridge",
    operation: "probePath",
    rootSensitive: true,
  }),
  linux: Object.freeze({
    id: NativePathDriverIds.LINUX,
    platform: "linux",
    modes: Object.freeze(["native", "root"]),
    nativeBoundary: "socket-or-ebpf",
    operation: "probePath",
    rootSensitive: true,
  }),
  windows: Object.freeze({
    id: NativePathDriverIds.WINDOWS,
    platform: "windows",
    modes: Object.freeze(["native"]),
    nativeBoundary: "wfp",
    operation: "probePath",
    rootSensitive: false,
  }),
  macos: Object.freeze({
    id: NativePathDriverIds.MACOS,
    platform: "macos",
    modes: Object.freeze(["native"]),
    nativeBoundary: "network-extension",
    operation: "probePath",
    rootSensitive: false,
  }),
  ios: Object.freeze({
    id: NativePathDriverIds.IOS,
    platform: "ios",
    modes: Object.freeze(["native"]),
    nativeBoundary: "network-extension",
    operation: "probePath",
    rootSensitive: false,
  }),
});

function profileFor(platform) {
  const profile = DRIVER_PROFILES[platform];
  if (!profile) throw new TypeError("unsupported platform: " + platform);
  return profile;
}

function normalizeMode(profile, mode) {
  return profile.modes.includes(mode) ? mode : profile.modes[0];
}

export function inspectNativePathDriver(platform, { mode = null } = {}) {
  const profile = profileFor(platform);
  return Object.freeze({
    version: PLATFORM_NATIVE_PATH_DRIVER_VERSION,
    ...profile,
    mode: normalizeMode(profile, mode),
  });
}

export function createNativePathDriverBinding(platformImplementation, { mode = null } = {}) {
  if (!platformImplementation || typeof platformImplementation !== "object") {
    throw new TypeError("platform implementation is required");
  }

  const profile = profileFor(platformImplementation.platform);
  const selectedMode = normalizeMode(profile, mode);
  const capabilities = Array.isArray(platformImplementation.capabilities)
    ? platformImplementation.capabilities
    : [];

  const capabilityDeclared = capabilities.includes("path-probe");
  const operationAvailable = typeof platformImplementation[profile.operation] === "function";

  return Object.freeze({
    version: PLATFORM_NATIVE_PATH_DRIVER_VERSION,
    id: profile.id,
    platform: profile.platform,
    mode: selectedMode,
    nativeBoundary: profile.nativeBoundary,
    rootSensitive: profile.rootSensitive,
    operation: profile.operation,
    capabilityDeclared,
    operationAvailable,
    supported: capabilityDeclared && operationAvailable,
    reason: !capabilityDeclared
      ? "capability-unavailable"
      : !operationAvailable
        ? "native-operation-unavailable"
        : "ready",
  });
}
