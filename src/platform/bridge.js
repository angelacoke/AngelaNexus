
import { PlatformCapabilities, createPlatformContract } from "./contract.js";

function requireCapability(platform, capability) {
  if (!platform.capabilities.includes(capability)) throw new Error("platform capability unavailable: " + capability);
}

export function createPlatformBridge(implementation) {
  const platform = createPlatformContract(implementation);
  return Object.freeze({
    platform: platform.platform,
    capabilities: platform.capabilities,
    async start() { await platform.start(); return platform.getNetworkState(); },
    async stop() { await platform.stop(); return platform.getNetworkState(); },
    async startTun(options = {}) { requireCapability(platform, PlatformCapabilities.TUN); return platform.startTun(options); },
    async stopTun() { requireCapability(platform, PlatformCapabilities.TUN); return platform.stopTun(); },
    async setSystemProxy(options = {}) { requireCapability(platform, PlatformCapabilities.SYSTEM_PROXY); return platform.setSystemProxy(options); },
    async setAppExclusions(packages = []) { requireCapability(platform, PlatformCapabilities.APP_EXCLUSION); return platform.setAppExclusions(packages); },
    async setProcessExclusions(processes = []) { requireCapability(platform, PlatformCapabilities.PROCESS_EXCLUSION); return platform.setProcessExclusions(processes); },
    async subscribeNetworkState(listener) {
      requireCapability(platform, PlatformCapabilities.NETWORK_MONITOR);
      if (typeof listener !== "function") throw new TypeError("network state listener must be a function");
      return platform.subscribeNetworkState(listener);
    },
    async enableNetworkBlock(reason = "kill-switch") { requireCapability(platform, PlatformCapabilities.NETWORK_BLOCK); return platform.enableNetworkBlock(reason); },
    async disableNetworkBlock(reason = "kill-switch-release") { requireCapability(platform, PlatformCapabilities.NETWORK_BLOCK); return platform.disableNetworkBlock(reason); },
    async startBackgroundService(options = {}) { requireCapability(platform, PlatformCapabilities.BACKGROUND_SERVICE); return platform.startBackgroundService(options); },
    async stopBackgroundService() { requireCapability(platform, PlatformCapabilities.BACKGROUND_SERVICE); return platform.stopBackgroundService(); },
    async notify(notification) { requireCapability(platform, PlatformCapabilities.NOTIFICATIONS); return platform.notify(notification); },
    async getSecureValue(key) { requireCapability(platform, PlatformCapabilities.SECURE_STORAGE); return platform.getSecureValue(key); },
    async setSecureValue(key, value) { requireCapability(platform, PlatformCapabilities.SECURE_STORAGE); return platform.setSecureValue(key, value); },
    async deleteSecureValue(key) { requireCapability(platform, PlatformCapabilities.SECURE_STORAGE); return platform.deleteSecureValue(key); },
    async openNativeSocketPath(options = {}) { requireCapability(platform, PlatformCapabilities.NATIVE_SOCKET_PATH); return platform.openNativeSocketPath(options); },
    async validateNativeRoute(options = {}) { requireCapability(platform, PlatformCapabilities.NATIVE_ROUTE); return platform.validateNativeRoute(options); },
    async setTunBypass(options = {}) { requireCapability(platform, PlatformCapabilities.BYPASS_TUN); return platform.setTunBypass(options); },
    async validateRouteIntegrity(options = {}) { requireCapability(platform, PlatformCapabilities.ROUTE_INTEGRITY); return platform.validateRouteIntegrity(options); },
    async importConfiguration(input, options = {}) { requireCapability(platform, PlatformCapabilities.CONFIG_IMPORT); return platform.importConfiguration(input, options); },
    getNetworkState() { return platform.getNetworkState(); },
  });
}
