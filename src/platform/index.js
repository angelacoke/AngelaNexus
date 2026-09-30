export {
  PlatformId,
  PlatformCapabilities,
  createPlatformContract,
  getPlatformCapabilityRequirements,
} from "./contract.js";

export { createPlatformBridge } from "./bridge.js";
export { createConfigImportRequest, CONFIG_IMPORT_REQUEST_VERSION } from "./import-contract.js";
export { createConfigImportAdapter } from "./config-import-adapter.js";
export { createCoreImportRuntime } from "./core-import-runtime.js";
export {
  createCoreImportReceiver,
  parseConfigImportEnvelope,
  CONFIG_IMPORT_ENVELOPE_TYPE,
  CONFIG_IMPORT_ENVELOPE_MAX_BYTES,
} from "./runtime-import-receiver.js";
export { createRuntimeImportService } from "./runtime-import-service.js";
export { inspectPlatformCapabilities } from "./capability-inspector.js";
export {
  createRuntimeConfigImportTransport,
  serializeConfigImportRequest,
  RUNTIME_IMPORT_MAX_BYTES,
} from "./runtime-import.js";

export { createPlatformRuntime } from "./runtime.js";
