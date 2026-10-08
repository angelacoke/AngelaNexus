import { createCoreImportRuntime } from "./core-import-runtime.js";
import { CONFIG_IMPORT_REQUEST_VERSION } from "./import-contract.js";

export const CONFIG_IMPORT_ENVELOPE_TYPE = "angelanexus.config-import";
export const CONFIG_IMPORT_ENVELOPE_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_SOURCES = new Set(["local-file", "subscription-url", "text", "structured"]);

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function validateEnvelope(envelope, { maxBytes }) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("configuration import envelope must be an object");
  }
  if (envelope.type !== CONFIG_IMPORT_ENVELOPE_TYPE) {
    throw new TypeError("unsupported configuration import envelope type");
  }
  if (envelope.version !== CONFIG_IMPORT_REQUEST_VERSION) {
    throw new TypeError("unsupported configuration import envelope version: " + envelope.version);
  }
  if (!ALLOWED_SOURCES.has(envelope.source)) {
    throw new TypeError("unsupported configuration import source: " + envelope.source);
  }
  if (typeof envelope.content !== "string" || envelope.content.length === 0) {
    throw new TypeError("configuration import content must be non-empty");
  }
  if (envelope.name !== null && (typeof envelope.name !== "string" || envelope.name.length > 255)) {
    throw new TypeError("configuration import name is invalid");
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("configuration import maxBytes must be a positive integer");
  }
  if (byteLength(JSON.stringify(envelope)) > maxBytes) {
    throw new RangeError("configuration import envelope exceeds byte limit");
  }
}

export function parseConfigImportEnvelope(payload, { maxBytes = CONFIG_IMPORT_ENVELOPE_MAX_BYTES } = {}) {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new TypeError("configuration import envelope payload must be a non-empty string");
  }

  let envelope;
  try {
    envelope = JSON.parse(payload);
  } catch {
    throw new TypeError("configuration import envelope is not valid JSON");
  }

  validateEnvelope(envelope, { maxBytes });
  return Object.freeze({
    version: envelope.version,
    source: envelope.source,
    name: envelope.name ?? null,
    content: envelope.content,
  });
}

export function createCoreImportReceiver({ importer, maxBytes = CONFIG_IMPORT_ENVELOPE_MAX_BYTES } = {}) {
  const runtime = createCoreImportRuntime({ importer });
  return Object.freeze({
    async receive(payload, options = {}) {
      const request = parseConfigImportEnvelope(payload, { maxBytes });
      return runtime.importConfiguration(request.content, {
        ...options,
        prepareRuntimeHandoff: true,
        source: request.source,
        name: request.name,
      });
    },
  });
}
