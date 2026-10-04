const SUPPORTED_PLATFORMS = Object.freeze(["android", "ios", "windows", "macos", "linux"]);

const FIELDS = Object.freeze([
  "packageName",
  "bundleId",
  "processName",
  "processPath",
  "executable",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value) {
  const valueText = text(value);
  return valueText || null;
}

function normalizePlatform(value) {
  const platform = text(value).toLowerCase();
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error("unsupported application identity platform: " + platform);
  }
  return platform;
}

function normalizePath(value) {
  const path = text(value);
  return path ? path.replaceAll("\\", "/") : null;
}

/**
 * Stable application identity for policy matching.
 *
 * packageName/bundleId are stable application identifiers where the platform
 * exposes them. processName/processPath/executable are deliberately separate:
 * a process instance/PID is runtime evidence and must not become a persistent
 * routing rule identity.
 */
export function createApplicationIdentity(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("application identity must be an object");
  }

  const platform = normalizePlatform(input.platform);
  const packageName = optionalText(input.packageName);
  const bundleId = optionalText(input.bundleId);
  const processName = optionalText(input.processName);
  const processPath = normalizePath(input.processPath);
  const executable = normalizePath(input.executable);

  if (!packageName && !bundleId && !processName && !processPath && !executable) {
    throw new Error("application identity requires at least one stable identifier");
  }

  return Object.freeze({
    version: 1,
    platform,
    packageName,
    bundleId,
    processName,
    processPath,
    executable,
  });
}

export function applicationIdentityKey(identity) {
  const normalized = createApplicationIdentity(identity);
  return [
    normalized.platform,
    normalized.packageName || "",
    normalized.bundleId || "",
    normalized.processName || "",
    normalized.processPath || "",
    normalized.executable || "",
  ].join("|");
}

export function matchesApplicationIdentity(identity, selector = {}) {
  const actual = createApplicationIdentity(identity);
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    return false;
  }

  if (selector.platform && text(selector.platform).toLowerCase() !== actual.platform) return false;

  for (const field of FIELDS) {
    if (selector[field] === undefined || selector[field] === null) continue;
    const expected = field === "processPath" || field === "executable"
      ? normalizePath(selector[field])
      : optionalText(selector[field]);
    if (!expected) return false;
    if (actual[field] !== expected) return false;
  }

  return true;
}

export function normalizeApplicationSelector(selector = {}) {
  if (!selector || typeof selector !== "object" || Array.isArray(selector)) {
    throw new TypeError("application selector must be an object");
  }

  const normalized = {};
  if (selector.platform !== undefined) normalized.platform = normalizePlatform(selector.platform);
  for (const field of FIELDS) {
    if (selector[field] !== undefined) {
      const value = field === "processPath" || field === "executable"
        ? normalizePath(selector[field])
        : optionalText(selector[field]);
      if (value) normalized[field] = value;
    }
  }
  if (!Object.keys(normalized).length) {
    throw new Error("application selector requires at least one identifier");
  }
  return Object.freeze(normalized);
}

export function getApplicationIdentityCapabilities(platform) {
  const normalized = normalizePlatform(platform);
  return Object.freeze({
    platform: normalized,
    packageName: normalized === "android",
    bundleId: normalized === "ios" || normalized === "macos",
    processName: true,
    processPath: normalized !== "android" && normalized !== "ios",
    executable: normalized !== "android" && normalized !== "ios",
  });
}
