import { createRuntimeImportService } from "./runtime-import-service.js";

const runtime = createRuntimeImportService();

globalThis.angelanexusCoreImport = async (payload) => {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new TypeError("Core import payload must be a non-empty string");
  }
  const result = await runtime.receive(payload);
  return JSON.stringify({
    ok: true,
    result: {
      source: result?.source ?? null,
      nodeCount: result?.result?.model?.nodeCount ?? 0,
      kernel: result?.result?.binding?.kernel ?? null,
      detectionConfidence: result?.result?.binding?.prompt?.reason ?? null,
      executionIntent: result?.result?.executionIntent ?? null
    }
  });
};

globalThis.angelanexusCoreImportNamed = async (name) => {
  if (typeof name !== "string" || !name) throw new TypeError("Core import data name is required");
  const bytes = await android.consumeNamedDataAsArrayBuffer(name);
  const payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return globalThis.angelanexusCoreImport(payload);
};

globalThis.angelanexusCoreRuntimeReady = true;
"READY";
