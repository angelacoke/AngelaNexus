const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_SOURCES = new Set(["local-file", "subscription-url", "text", "structured"]);

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function validateRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("runtime import request is required");
  if (request.version !== 1) throw new TypeError("unsupported runtime import version: " + request.version);
  if (!ALLOWED_SOURCES.has(request.source)) throw new TypeError("unsupported runtime import source: " + request.source);
  if (typeof request.content !== "string" || request.content.length === 0) throw new TypeError("runtime import content must be non-empty");
  if (request.name !== null && (typeof request.name !== "string" || request.name.length > 255)) throw new TypeError("runtime import name is invalid");
}

export function serializeConfigImportRequest(request, { maxBytes = MAX_PAYLOAD_BYTES } = {}) {
  validateRequest(request);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new TypeError("runtime import maxBytes must be a positive integer");
  const payload = JSON.stringify({
    type: "angelanexus.config-import",
    version: request.version,
    source: request.source,
    name: request.name ?? null,
    content: request.content,
  });
  if (byteLength(payload) > maxBytes) throw new RangeError("runtime import payload exceeds byte limit");
  return payload;
}

export function createRuntimeConfigImportTransport({ send, maxBytes = MAX_PAYLOAD_BYTES } = {}) {
  if (typeof send !== "function") throw new TypeError("runtime import transport send function is required");
  return Object.freeze({
    async importConfiguration(request) {
      const payload = serializeConfigImportRequest(request, { maxBytes });
      return send(payload);
    },
  });
}

export { MAX_PAYLOAD_BYTES as RUNTIME_IMPORT_MAX_BYTES };
