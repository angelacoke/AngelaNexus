import { createServer } from "node:http";
import { createRuntimeImportService } from "./runtime-import-service.js";

export const CORE_RUNTIME_IMPORT_PATH = "/v1/runtime/import";
export const CORE_RUNTIME_MAX_BODY_BYTES = 5 * 1024 * 1024;
export const CORE_RUNTIME_BODY_TIMEOUT_MS = 30_000;
const NODE_TIMER_MAX_MS = 2_147_483_647;

function jsonResponse(response, status, body, { close = false } = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...(close ? { Connection: "close" } : {}),
  });
  response.end(payload);
}

function requestContentType(request) {
  const value = request.headers["content-type"];
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

function timeoutError() {
  return Object.assign(new Error("request body timeout"), { code: "BODY_TIMEOUT" });
}

function drainRequest(request) {
  const swallowError = () => {};
  request.once("close", () => request.removeListener("error", swallowError));
  request.on("error", swallowError);
  request.resume();
}

async function readBody(request, maxBytes, signal) {
  const chunks = [];
  let total = 0;

  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredBytes = Number(contentLength);
    if (!Number.isInteger(declaredBytes) || declaredBytes < 0) {
      throw Object.assign(new TypeError("content-length header is invalid"), { code: "INVALID_CONTENT_LENGTH" });
    }
    if (declaredBytes > maxBytes) {
      // Drain an already-buffered oversized request without allocating it.
      drainRequest(request);
      throw Object.assign(new RangeError("request body exceeds byte limit"), { code: "PAYLOAD_TOO_LARGE" });
    }
  }

  if (signal?.aborted) throw timeoutError();

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        drainRequest(request);
        finish(Object.assign(new RangeError("request body exceeds byte limit"), { code: "PAYLOAD_TOO_LARGE" }));
      } else {
        chunks.push(buffer);
      }
    };
    const onEnd = () => finish();
    const onError = (error) => finish(error);
    const onAborted = () => {
      drainRequest(request);
      finish(Object.assign(new Error("request body was aborted"), { code: "REQUEST_ABORTED" }));
    };
    const onAbort = () => {
      // Keep consuming until the timeout response is flushed; this prevents a
      // late stream error from becoming an unhandled exception.
      drainRequest(request);
      finish(timeoutError());
    };
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

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
  bodyTimeoutMs = CORE_RUNTIME_BODY_TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("Core runtime maxBytes must be a positive integer");
  }
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs <= 0 || bodyTimeoutMs > NODE_TIMER_MAX_MS) {
    throw new TypeError("Core runtime bodyTimeoutMs must be a positive integer within the Node timer limit");
  }

  const service = createRuntimeImportService({ importer, maxBytes });

  return createServer(async (request, response) => {
    const timeoutController = new AbortController();
    let timeoutHandle;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timeoutController.abort();
        reject(timeoutError());
      }, bodyTimeoutMs);
    });
    try {
      if (request.method !== "POST" || request.url !== CORE_RUNTIME_IMPORT_PATH) {
        jsonResponse(response, 404, { ok: false, error: "not-found" });
        return;
      }

      if (requestContentType(request) !== "application/json") {
        jsonResponse(response, 415, { ok: false, error: "unsupported-content-type" });
        return;
      }

      const payload = await Promise.race([readBody(request, maxBytes, timeoutController.signal), timeout]);
      clearTimeout(timeoutHandle);
      timeoutHandle = undefined;
      const result = await service.receive(payload);
      jsonResponse(response, 200, { ok: true, result: summarize(result) });
    } catch (error) {
      const code = error?.code;
      const timedOut = code === "BODY_TIMEOUT";
      const status = timedOut ? 408 : code === "PAYLOAD_TOO_LARGE" ? 413
        : code === "INVALID_UTF8" || code === "INVALID_CONTENT_LENGTH" ? 400
        : 400;
      if (timedOut) response.shouldKeepAlive = false;
      if (!response.destroyed && !response.writableEnded) {
        const socket = response.socket;
        jsonResponse(response, status, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, { close: timedOut });
        if (timedOut) response.once("finish", () => socket?.destroy());
      }
    } finally {
      clearTimeout(timeoutHandle);
    }
  });
}
