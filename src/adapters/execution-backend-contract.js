export const ExecutionBackendCapabilities = Object.freeze({
  CONFIG_COMPILE: "config-compile",
  STREAM_EXECUTION: "stream-execution",
  DATAGRAM_EXECUTION: "datagram-execution",
  LIFECYCLE: "lifecycle",
  STATUS: "status",
  LOGS: "logs",
});

const REQUIRED = ["id", "capabilities", "canExecute", "execute"];

export function createExecutionBackend(implementation) {
  if (!implementation || typeof implementation !== "object") throw new TypeError("execution backend is required");
  for (const key of REQUIRED) {
    if (typeof implementation[key] === "undefined") throw new TypeError("execution backend missing: " + key);
  }
  if (typeof implementation.id !== "string" || !implementation.id.trim()) {
    throw new TypeError("execution backend id is required");
  }
  if (!Array.isArray(implementation.capabilities)) {
    throw new TypeError("execution backend capabilities must be an array");
  }
  if (typeof implementation.canExecute !== "function" || typeof implementation.execute !== "function") {
    throw new TypeError("execution backend canExecute/execute must be functions");
  }
  return Object.freeze({
    ...implementation,
    id: implementation.id.trim(),
    capabilities: Object.freeze([...new Set(implementation.capabilities)]),
  });
}

export function hasExecutionBackendCapability(backend, capability) {
  return Boolean(backend?.capabilities?.includes(capability));
}

export function findExecutionBackend(backends, plan) {
  if (!Array.isArray(backends)) return null;
  return backends.find((backend) => {
    try { return backend.canExecute(plan) === true; } catch { return false; }
  }) || null;
}
