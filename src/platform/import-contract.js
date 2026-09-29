const ALLOWED_SOURCES = new Set(["local-file", "subscription-url", "text", "structured"]);
export const CONFIG_IMPORT_REQUEST_VERSION = 1;

export function createConfigImportRequest(input, { source = "text", name = null } = {}) {
  if (!ALLOWED_SOURCES.has(source)) throw new TypeError("unsupported config import source: " + source);
  if (typeof input !== "string" || input.length === 0) throw new TypeError("config import payload must be a non-empty string");
  if (name !== null && (typeof name !== "string" || name.length > 255)) throw new TypeError("config import name is invalid");
  return Object.freeze({
    version: CONFIG_IMPORT_REQUEST_VERSION,
    source,
    name,
    content: input,
  });
}
