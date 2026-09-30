import { createCoreImportReceiver } from "./runtime-import-receiver.js";

/**
 * Core-facing service for platform configuration imports.
 *
 * Platform adapters provide only the serialized envelope. Validation and delegation
 * remain in Core so every platform follows the same import contract.
 */
export function createRuntimeImportService({ importer, maxBytes } = {}) {
  const receiver = createCoreImportReceiver({ importer, maxBytes });
  return Object.freeze({
    async receive(payload, options = {}) {
      return receiver.receive(payload, options);
    },
  });
}
