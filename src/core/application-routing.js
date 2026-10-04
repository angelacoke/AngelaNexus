export const APPLICATION_ROUTING_IDENTITY_VERSION = 1;

const PLATFORMS = Object.freeze(["android", "windows", "macos", "linux", "ios"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(text).filter(Boolean))];
}

export function createApplicationRoutingIdentity({
  id,
  platform,
  packageName = null,
  processName = null,
  processPath = null,
  executable = null,
  displayName = null,
  signature = null,
  metadata = {},
} = {}) {
  const normalizedPlatform = text(platform).toLowerCase();
  if (!PLATFORMS.includes(normalizedPlatform)) {
    throw new Error("unsupported application routing platform: " + normalizedPlatform);
  }

  const packages = list(packageName);
  const processes = list(processName);
  const paths = list(processPath);
  const executables = list(executable);
  if (!packages.length && !processes.length && !paths.length && !executables.length) {
    throw new Error("application routing identity requires a package, process, path, or executable");
  }

  return Object.freeze({
    version: APPLICATION_ROUTING_IDENTITY_VERSION,
    id: text(id) || null,
    platform: normalizedPlatform,
    packageName: packages,
    processName: processes,
    processPath: paths,
    executable: executables,
    displayName: text(displayName) || null,
    signature: signature && typeof signature === "object" ? structuredClone(signature) : null,
    metadata: metadata && typeof metadata === "object" ? structuredClone(metadata) : {},
  });
}

export function toRoutingContext(identity, {
  observedProcessName = null,
  observedProcessPath = null,
  observedPackageName = null,
} = {}) {
  if (!identity || typeof identity !== "object") {
    throw new TypeError("application routing identity is required");
  }

  return Object.freeze({
    platform: identity.platform || null,
    applicationId: identity.id || null,
    package_name: list([...(identity.packageName || []), observedPackageName]),
    process_name: list([...(identity.processName || []), observedProcessName]),
    process_path: list([...(identity.processPath || []), observedProcessPath]),
    executable: list(identity.executable),
  });
}

export function validateApplicationRoutingIdentity(identity) {
  try {
    createApplicationRoutingIdentity(identity);
    return Object.freeze({ ok: true, errors: Object.freeze([]) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      errors: Object.freeze([error instanceof Error ? error.message : String(error)]),
    });
  }
}
