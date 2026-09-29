
export const PlatformId = Object.freeze({
  ANDROID: "android",
  IOS: "ios",
  WINDOWS: "windows",
  MACOS: "macos",
  LINUX: "linux",
});

export const PlatformCapabilities = Object.freeze({
  TUN: "tun",
  SYSTEM_PROXY: "system-proxy",
  APP_EXCLUSION: "app-exclusion",
  PROCESS_EXCLUSION: "process-exclusion",
  NETWORK_MONITOR: "network-monitor",
  NETWORK_BLOCK: "network-block",
  BACKGROUND_SERVICE: "background-service",
  NOTIFICATIONS: "notifications",
  SECURE_STORAGE: "secure-storage",
  NATIVE_SOCKET_PATH: "native-socket-path",
  NATIVE_ROUTE: "native-route",
  BYPASS_TUN: "bypass-tun",
  ROUTE_INTEGRITY: "route-integrity",
  CONFIG_IMPORT: "config-import",
});

const CAPABILITY_METHODS = Object.freeze({
  [PlatformCapabilities.TUN]: Object.freeze(["startTun", "stopTun"]),
  [PlatformCapabilities.SYSTEM_PROXY]: Object.freeze(["setSystemProxy"]),
  [PlatformCapabilities.APP_EXCLUSION]: Object.freeze(["setAppExclusions"]),
  [PlatformCapabilities.PROCESS_EXCLUSION]: Object.freeze(["setProcessExclusions"]),
  [PlatformCapabilities.NETWORK_MONITOR]: Object.freeze(["subscribeNetworkState"]),
  [PlatformCapabilities.NETWORK_BLOCK]: Object.freeze(["enableNetworkBlock", "disableNetworkBlock"]),
  [PlatformCapabilities.BACKGROUND_SERVICE]: Object.freeze(["startBackgroundService", "stopBackgroundService"]),
  [PlatformCapabilities.NOTIFICATIONS]: Object.freeze(["notify"]),
  [PlatformCapabilities.SECURE_STORAGE]: Object.freeze(["getSecureValue", "setSecureValue", "deleteSecureValue"]),
  [PlatformCapabilities.NATIVE_SOCKET_PATH]: Object.freeze(["openNativeSocketPath"]),
  [PlatformCapabilities.NATIVE_ROUTE]: Object.freeze(["validateNativeRoute"]),
  [PlatformCapabilities.BYPASS_TUN]: Object.freeze(["setTunBypass"]),
  [PlatformCapabilities.ROUTE_INTEGRITY]: Object.freeze(["validateRouteIntegrity"]),
  [PlatformCapabilities.CONFIG_IMPORT]: Object.freeze(["importConfiguration"]),
});

function validateCapabilityMethods(implementation, capabilities) {
  for (const capability of capabilities) {
    const methods = CAPABILITY_METHODS[capability];
    if (!methods) throw new TypeError("unsupported platform capability: " + capability);
    for (const method of methods) {
      if (typeof implementation[method] !== "function") {
        throw new TypeError("platform capability " + capability + " requires method: " + method);
      }
    }
  }
}

export function createPlatformContract(implementation) {
  if (!implementation || typeof implementation !== "object") throw new TypeError("platform implementation is required");
  const required = ["platform", "capabilities", "start", "stop", "getNetworkState"];
  for (const key of required) {
    if (typeof implementation[key] === "undefined") throw new TypeError("platform implementation missing: " + key);
  }
  if (!Object.values(PlatformId).includes(implementation.platform)) throw new TypeError("unsupported platform: " + implementation.platform);
  if (!Array.isArray(implementation.capabilities)) throw new TypeError("platform capabilities must be an array");
  const capabilities = [...new Set(implementation.capabilities)];
  validateCapabilityMethods(implementation, capabilities);
  return Object.freeze({ ...implementation, capabilities: Object.freeze(capabilities) });
}

export function getPlatformCapabilityRequirements(capability) {
  const methods = CAPABILITY_METHODS[capability];
  if (!methods) throw new TypeError("unsupported platform capability: " + capability);
  return Object.freeze([...methods]);
}
