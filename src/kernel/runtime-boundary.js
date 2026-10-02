import { getKernelRuntimeCapabilities } from "./runtime-capabilities.js";

export const RUNTIME_BOUNDARY_VERSION = 1;

export function resolveKernelRuntimeMode(kernel, platform, {
  requestedMode = "auto",
  requireNative = false,
  preferNative = true,
} = {}) {
  if (!["auto", "process", "native"].includes(requestedMode)) {
    throw new TypeError("unsupported runtime mode: " + requestedMode);
  }

  const capabilities = getKernelRuntimeCapabilities(kernel, platform);
  if (requireNative && !capabilities.native) {
    return Object.freeze({
      ok: false,
      kernel,
      platform,
      requestedMode,
      selectedMode: null,
      reason: "native runtime is required but unavailable",
      capabilities,
    });
  }

  if (requestedMode === "native" && !capabilities.native) {
    return Object.freeze({
      ok: false,
      kernel,
      platform,
      requestedMode,
      selectedMode: null,
      reason: "requested native runtime is unavailable",
      capabilities,
    });
  }

  const selectedMode = requestedMode === "auto"
    ? (preferNative && capabilities.native ? "native" : "process")
    : requestedMode;

  if (!capabilities[selectedMode]) {
    return Object.freeze({
      ok: false,
      kernel,
      platform,
      requestedMode,
      selectedMode: null,
      reason: "requested runtime mode is unavailable",
      capabilities,
    });
  }

  return Object.freeze({
    ok: true,
    kernel,
    platform,
    requestedMode,
    selectedMode,
    reason: "runtime mode is explicitly supported by the capability registry",
    capabilities,
  });
}

export function requireKernelRuntimeMode(kernel, platform, options = {}) {
  const result = resolveKernelRuntimeMode(kernel, platform, options);
  if (!result.ok) throw new Error(
    kernel + " runtime mode rejected: " + result.reason,
  );
  return result;
}
