const PLATFORMS = Object.freeze(["android", "ios", "windows", "macos", "linux"]);

const PLATFORM_CONTRACT = Object.freeze({
  android: Object.freeze({
    family: "mobile",
    requiresNativeNetworkAdapter: true,
    requiresVpnService: true,
    sharedCore: true,
    sharedImportPipeline: true,
    sharedSecurityPolicy: true,
  }),
  ios: Object.freeze({
    family: "mobile",
    requiresNativeNetworkAdapter: true,
    requiresVpnService: true,
    sharedCore: true,
    sharedImportPipeline: true,
    sharedSecurityPolicy: true,
  }),
  windows: Object.freeze({
    family: "desktop",
    requiresNativeNetworkAdapter: true,
    requiresVpnService: false,
    sharedCore: true,
    sharedImportPipeline: true,
    sharedSecurityPolicy: true,
  }),
  macos: Object.freeze({
    family: "desktop",
    requiresNativeNetworkAdapter: true,
    requiresVpnService: false,
    sharedCore: true,
    sharedImportPipeline: true,
    sharedSecurityPolicy: true,
  }),
  linux: Object.freeze({
    family: "desktop",
    requiresNativeNetworkAdapter: true,
    requiresVpnService: false,
    sharedCore: true,
    sharedImportPipeline: true,
    sharedSecurityPolicy: true,
  }),
});

export function getSupportedPlatforms() {
  return PLATFORMS.slice();
}

export function getPlatformContract(platform) {
  const contract = PLATFORM_CONTRACT[platform];
  if (!contract) throw new Error("unsupported platform: " + platform);
  return contract;
}

export function isSupportedPlatform(platform) {
  return Object.prototype.hasOwnProperty.call(PLATFORM_CONTRACT, platform);
}
