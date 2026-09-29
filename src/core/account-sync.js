const SHARED_CATEGORIES = Object.freeze([
  "profiles",
  "proxyPreferences",
  "routingPolicies",
  "securityPreferences",
  "gfwPreferences",
  "uiPreferences",
  "ruleOverrides",
  "importSources",
  "appPreferences"
]);

const LOCAL_CATEGORIES = Object.freeze([
  "kernelRuntimeState",
  "vpnSessionState",
  "platformPermissions",
  "platformNetworkState",
  "secureCredentials",
  "deviceSecrets",
  "localLogs",
  "cache"
]);

const PLATFORM_KEYS = Object.freeze(["android", "ios", "windows", "macos", "linux"]);

export const AccountDataScope = Object.freeze({
  SHARED: "shared",
  PLATFORM: "platform",
  LOCAL: "local"
});

export const SyncCategories = Object.freeze({
  shared: SHARED_CATEGORIES,
  local: LOCAL_CATEGORIES
});

export function createAccountSnapshot({ accountId, data = {}, platform = null, schemaVersion = 1 } = {}) {
  if (!accountId || typeof accountId !== "string") throw new TypeError("accountId is required");
  if (platform !== null && !PLATFORM_KEYS.includes(platform)) throw new TypeError("unsupported platform");
  const shared = {};
  for (const key of SHARED_CATEGORIES) if (data[key] !== undefined) shared[key] = data[key];
  const platformState = platform && data.platformState && typeof data.platformState === "object"
    ? { [platform]: data.platformState }
    : {};
  return Object.freeze({
    schemaVersion,
    accountId,
    shared: Object.freeze(shared),
    platform: Object.freeze(platformState)
  });
}

export function mergeAccountSnapshots(base, incoming) {
  if (!base || !incoming || base.accountId !== incoming.accountId) throw new TypeError("account identity mismatch");
  const shared = { ...(base.shared || {}), ...(incoming.shared || {}) };
  const platform = { ...(base.platform || {}), ...(incoming.platform || {}) };
  return Object.freeze({
    schemaVersion: Math.max(base.schemaVersion || 1, incoming.schemaVersion || 1),
    accountId: base.accountId,
    shared: Object.freeze(shared),
    platform: Object.freeze(platform)
  });
}

export function createBackupManifest(snapshot, { createdAt, appVersion, sourcePlatform } = {}) {
  if (!snapshot || !snapshot.accountId) throw new TypeError("snapshot is required");
  return Object.freeze({
    format: "angelanexus-backup",
    formatVersion: 1,
    schemaVersion: snapshot.schemaVersion || 1,
    accountId: snapshot.accountId,
    createdAt: createdAt || new Date().toISOString(),
    appVersion: appVersion || null,
    sourcePlatform: sourcePlatform || null,
    includes: Object.freeze({ shared: true, platformState: true, secureCredentials: false, deviceSecrets: false })
  });
}

export function classifySyncData(data = {}) {
  const shared = {};
  const local = {};
  for (const key of SHARED_CATEGORIES) if (data[key] !== undefined) shared[key] = data[key];
  for (const key of LOCAL_CATEGORIES) if (data[key] !== undefined) local[key] = data[key];
  return Object.freeze({ shared: Object.freeze(shared), local: Object.freeze(local) });
}

export function validateBackupManifest(manifest) {
  const errors = [];
  if (!manifest || manifest.format !== "angelanexus-backup") errors.push("invalid backup format");
  if (!manifest || manifest.formatVersion !== 1) errors.push("unsupported backup format version");
  if (!manifest || !manifest.accountId) errors.push("backup accountId is required");
  if (manifest?.includes?.secureCredentials === true || manifest?.includes?.deviceSecrets === true) {
    errors.push("backup must not contain secure credentials or device secrets");
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
