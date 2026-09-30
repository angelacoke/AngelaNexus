import { createConfigImportAdapter } from "./config-import-adapter.js";

export function createCoreImportRuntime({ importer } = {}) {
  const adapter = createConfigImportAdapter({ importer });
  return Object.freeze({
    async importConfiguration(input, options = {}) {
      const result = await adapter.importConfiguration(input, options);
      return result.result;
    },
  });
}
