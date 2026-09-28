import { configIntegrityDigest, scanSecrets } from "./config-integrity.js";

export const SENSITIVE_SOURCE_VERSION = 1;

/**
 * Keeps the original import available to the native runtime without making
 * credential-bearing content enumerable or serializable by default.
 */
export function createSensitiveSourceCarrier(source) {
  const carrier = {
    version: SENSITIVE_SOURCE_VERSION,
    digest: configIntegrityDigest(source),
    credentialBearing: scanSecrets(source).findings.some((item) => item.type === "credential-uri")
  };
  Object.defineProperty(carrier, "runtimeSource", {
    value: source,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return Object.freeze(carrier);
}

export function getRuntimeSource(carrier) {
  if (!carrier || typeof carrier !== "object") return undefined;
  return carrier.runtimeSource;
}
