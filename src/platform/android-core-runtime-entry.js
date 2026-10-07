import { createRuntimeImportService } from "./runtime-import-service.js";

const runtime = createRuntimeImportService();

globalThis.angelanexusCoreImport = async (payload) => {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new TypeError("Core import payload must be a non-empty string");
  }
  return JSON.stringify(await runtime.receive(payload));
};

globalThis.angelanexusCoreRuntimeReady = true;
"READY";
