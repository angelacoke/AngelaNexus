import { Kernels } from "../core/model.js";

export const KernelDriverCapabilities = Object.freeze({
  NODE_COMPILE: "node-compile",
  PIPELINE_COMPILE: "pipeline-compile",
  PROCESS_RUNTIME: "process-runtime",
  NATIVE_RUNTIME: "native-runtime",
});

const REQUIRED = ["kernel", "capabilities", "compileNode", "compilePipeline", "createRuntime"];

export function createKernelDriver(implementation) {
  if (!implementation || typeof implementation !== "object") throw new TypeError("kernel driver is required");
  for (const key of REQUIRED) {
    if (typeof implementation[key] === "undefined") throw new TypeError("kernel driver missing: " + key);
  }
  if (!Object.values(Kernels).includes(implementation.kernel)) {
    throw new TypeError("unsupported kernel driver: " + implementation.kernel);
  }
  if (!Array.isArray(implementation.capabilities)) {
    throw new TypeError("kernel driver capabilities must be an array");
  }
  if (typeof implementation.compileNode !== "function") throw new TypeError("kernel driver compileNode must be a function");
  if (typeof implementation.compilePipeline !== "function") throw new TypeError("kernel driver compilePipeline must be a function");
  if (typeof implementation.createRuntime !== "function") throw new TypeError("kernel driver createRuntime must be a function");

  return Object.freeze({
    ...implementation,
    capabilities: Object.freeze([...new Set(implementation.capabilities)]),
  });
}

export function hasKernelDriverCapability(driver, capability) {
  return Boolean(driver && driver.capabilities?.includes(capability));
}
