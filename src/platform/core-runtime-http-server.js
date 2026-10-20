import { createServer } from "node:http";
import { createRuntimeImportService } from "./runtime-import-service.js";

export const CORE_RUNTIME_IMPORT_PATH = "/v1/runtime/import";
export const CORE_RUNTIME_MAX_BODY_BYTES = 5 * 1024 * 1024;

function jsonResponse(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  response.end(payload);
}

function requestContentType(request) {
  const value = request.headers["content-type"];
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredBytes = Number(contentLength);
    if (!Number.isInteger(declaredBytes) || declaredBytes < 0) {
      throw Object.assign(new TypeError("content-length header is invalid"), { code: "INVALID_CONTENT_LENGTH" });
    }
    if (declaredBytes > maxBytes) {
      // Stop consuming an already-buffered oversized request. This gives the
      // caller a deterministic 413 without allocating the request body.
      request.resume();
      throw Object.assign(new RangeError("request body exceeds byte limit"), { code: "PAYLOAD_TOO_LARGE" });
    }
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      request.resume();
      throw Object.assign(new RangeError("request body exceeds byte limit"), { code: "PAYLOAD_TOO_LARGE" });
    }
    chunks.push(buffer);
  }

  const bytes = Buffer.concat(chunks);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw Object.assign(new TypeError("request body is not valid UTF-8"), { code: "INVALID_UTF8", cause: error });
  }
}

function summarize(result) {
  return {
    version: result?.binding ? 1 : null,
    source: result?.source ?? null,
    nodeCount: result?.model?.nodeCount ?? 0,
    kernel: result?.binding?.kernel ?? null,
    detectionConfidence: result?.binding?.prompt?.reason ?? null,
    configuration: result?.runtimeHandoff?.configuration ?? null,
    executionIntent: result?.runtimeHandoff?.executionIntent ?? result?.executionIntent ?? null,
  };
}

export function createCoreRuntimeHttpServer({
  importer,
  maxBytes = CORE_RUNTIME_MAX_BODY_BYTES,
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Core runtime maxBytes must be a positive integer");
  }

  const service = createRuntimeImportService({ importer, maxBytes });

  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== CORE_RUNTIME_IMPORT_PATH) {
        jsonResponse(response, 404, { ok: false, error: "not-found" });
        return;
      }

      if (requestContentType(request) !== "application/json") {
        jsonResponse(response, 415, { ok: false, error: "unsupported-content-type" });
        return;
      }

      const payload = await readBody(request, maxBytes);
      const result = await service.receive(payload);
      jsonResponse(response, 200, { ok: true, result: summarize(result) });
    } catch (error) {
      const code = error?.code;
      const status = code === "PAYLOAD_TOO_LARGE" ? 413
        : code === "INVALID_UTF8" || code === "INVALID_CONTENT_LENGTH" ? 400
        : 400;
      jsonResponse(response, status, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
