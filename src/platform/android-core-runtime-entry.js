import { createRuntimeImportService } from "./runtime-import-service.js";

const runtime = createRuntimeImportService();

globalThis.angelanexusCoreImport = async (payload) => {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new TypeError("Core import payload must be a non-empty string");
  }
  const result = await runtime.receive(payload);
  const envelope = JSON.parse(payload);
  return JSON.stringify({
    ok: true,
    result: {
      source: envelope.source ?? null,
      nodeCount: result?.model?.nodeCount ?? 0,
      kernel: result?.binding?.kernel ?? null,
      detectionConfidence: result?.binding?.prompt?.reason ?? null,
      configuration: result?.runtimeHandoff?.configuration ?? null,
      executionIntent: result?.runtimeHandoff?.executionIntent ?? null
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
