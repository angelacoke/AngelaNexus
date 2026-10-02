export const NATIVE_PATH_PROBE_DRIVER_VERSION = 1;

export const NativePathProbeStates = Object.freeze({
  READY: "ready",
  UNSUPPORTED: "unsupported",
});

const REQUIRED_OPERATION = "probePath";

const PLATFORM_DRIVER_MODES = Object.freeze({
  android: Object.freeze(["non-root", "root"]),
  linux: Object.freeze(["native", "root"]),
  windows: Object.freeze(["native"]),
  macos: Object.freeze(["native"]),
  ios: Object.freeze(["native"]),
});

function normalizeMode(platform, mode) {
  const modes = PLATFORM_DRIVER_MODES[platform];
  if (!modes) throw new TypeError("unsupported platform: " + platform);
  return modes.includes(mode) ? mode : modes[0];
}

function normalizeProbeResult(result) {
  if (typeof result === "string") {
    return Object.freeze({ result });
  }
  if (!result || typeof result !== "object") {
    return Object.freeze({ result: "failure", reason: "invalid-native-result" });
  }
  return Object.freeze({ ...result });
}

export function createNativePathProbeDriver(platformImplementation, { mode = null } = {}) {
  if (!platformImplementation || typeof platformImplementation !== "object") {
    throw new TypeError("platform implementation is required");
  }

  const platform = platformImplementation.platform;
  const modes = PLATFORM_DRIVER_MODES[platform];
  if (!modes) throw new TypeError("unsupported platform: " + platform);

  const selectedMode = normalizeMode(platform, mode);
  const capabilities = Array.isArray(platformImplementation.capabilities)
    ? [...new Set(platformImplementation.capabilities)]
    : [];

  if (!capabilities.includes("path-probe") || typeof platformImplementation[REQUIRED_OPERATION] !== "function") {
    return Object.freeze({
      version: NATIVE_PATH_PROBE_DRIVER_VERSION,
      platform,
      mode: selectedMode,
      state: NativePathProbeStates.UNSUPPORTED,
      supported: false,
      reason: "native-driver-unavailable",
      probe: null,
    });
  }

  async function probe(task = {}) {
    const result = await platformImplementation[REQUIRED_OPERATION](Object.freeze({
      ...task,
      platform,
      mode: selectedMode,
      driverVersion: NATIVE_PATH_PROBE_DRIVER_VERSION,
    }));
    return normalizeProbeResult(result);
  }

  return Object.freeze({
    version: NATIVE_PATH_PROBE_DRIVER_VERSION,
    platform,
    mode: selectedMode,
    state: NativePathProbeStates.READY,
    supported: true,
    reason: "native-operation-bound",
    probe,
  });
}

export function getNativePathProbeDriverModes(platform) {
  const modes = PLATFORM_DRIVER_MODES[platform];
  if (!modes) throw new TypeError("unsupported platform: " + platform);
  return Object.freeze([...modes]);
}
