export const PLATFORM_NATIVE_PROBE_BINDING_VERSION = 1;

const OPERATIONS = Object.freeze([
  "probePath",
]);

const PLATFORM_OPERATION_NAMES = Object.freeze({
  android: Object.freeze({ probePath: "probePath" }),
  linux: Object.freeze({ probePath: "probePath" }),
  windows: Object.freeze({ probePath: "probePath" }),
  macos: Object.freeze({ probePath: "probePath" }),
  ios: Object.freeze({ probePath: "probePath" }),
});

function validateOperation(platform, operation) {
  const names = PLATFORM_OPERATION_NAMES[platform];
  return Boolean(names && names[operation]);
}

export function createPlatformNativeProbeBinding(platformImplementation) {
  if (!platformImplementation || typeof platformImplementation !== "object") {
    throw new TypeError("platform implementation is required");
  }

  const platform = platformImplementation.platform;
  if (!PLATFORM_OPERATION_NAMES[platform]) {
    throw new TypeError("unsupported platform: " + platform);
  }

  const capabilities = Array.isArray(platformImplementation.capabilities)
    ? Object.freeze([...new Set(platformImplementation.capabilities)])
    : Object.freeze([]);

  const operations = Object.freeze(
    OPERATIONS.filter((operation) =>
      capabilities.includes("path-probe") && validateOperation(platform, operation)
        ? typeof platformImplementation[operation] === "function"
        : false,
    ),
  );

  return Object.freeze({
    version: PLATFORM_NATIVE_PROBE_BINDING_VERSION,
    platform,
    capabilities,
    operations,
    supported: operations.includes("probePath"),
    reason: operations.includes("probePath")
      ? "native-operation-available"
      : "native-operation-unavailable",
  });
}
