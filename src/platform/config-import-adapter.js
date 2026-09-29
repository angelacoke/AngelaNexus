import { createConfigImportRequest } from "./import-contract.js";
import { importSource } from "../core/import-pipeline.js";

export function createConfigImportAdapter({ importer = importSource } = {}) {
  if (typeof importer !== "function") throw new TypeError("configuration importer must be a function");

  return Object.freeze({
    async importConfiguration(input, options = {}) {
      const request = createConfigImportRequest(input, options);
      const { version, source, name, content } = request;
      const importInput = source === "subscription-url"
        ? content
        : { type: source === "local-file" ? "file" : source, name, content };
      const result = await importer(importInput, options);
      return Object.freeze({ version, source, name, result });
    },
  });
}
