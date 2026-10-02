import { ANDROID_TRANSPARENT_MODES, inspectAndroidTransparentCapabilities, selectAndroidTransparentMode } from "./android-transparent-adapter.js";

export const ANDROID_NATIVE_TRANSPARENT_BINDING_VERSION = 1;

function requireFunction(value, name) {
  if (typeof value?.[name] !== "function") {
    throw new TypeError("android native transparent binding requires " + name);
  }
}

export function createAndroidNativeTransparentBinding({
  runtime = {},
  probePath,
  requestedMode = ANDROID_TRANSPARENT_MODES.AUTO,
} = {}) {
  requireFunction({ probePath }, "probePath");

  const capabilities = inspectAndroidTransparentCapabilities(runtime);
  const selection = selectAndroidTransparentMode(requestedMode, capabilities);
  const supported = selection.selected !== "unavailable";

  async function probePathBound(task = {}) {
    if (!supported) {
      return Object.freeze({ result: "rejected", reason: "transparent-mode-unavailable" });
    }
    return Object.freeze(await probePath(Object.freeze({
      ...task,
      mode: selection.selected,
      backend: selection.backend?.id || "android-system-vpn",
      capabilities: Object.freeze({ ...capabilities }),
    })));
  }

  return Object.freeze({
    version: ANDROID_NATIVE_TRANSPARENT_BINDING_VERSION,
    platform: "android",
    requestedMode: selection.requested,
    mode: selection.selected,
    supported,
    reason: selection.reason,
    capabilities,
    selection,
    probePath: probePathBound,
  });
}
