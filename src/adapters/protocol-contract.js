import { NodeProtocols } from "../core/model.js";

export const ProtocolCapabilities = Object.freeze({
  IDENTIFY: "protocol-identify",
  NODE_PARSE: "node-parse",
  NODE_NORMALIZE: "node-normalize",
  STREAM_OPEN: "stream-open",
  DATAGRAM_OPEN: "datagram-open",
});

const REQUIRED = ["protocol", "capabilities", "canHandle", "describe"];

export function createProtocolAdapter(implementation) {
  if (!implementation || typeof implementation !== "object") throw new TypeError("protocol adapter is required");
  for (const key of REQUIRED) {
    if (typeof implementation[key] === "undefined") throw new TypeError("protocol adapter missing: " + key);
  }
  if (!Object.values(NodeProtocols).includes(implementation.protocol)) {
    throw new TypeError("unsupported protocol adapter: " + implementation.protocol);
  }
  if (!Array.isArray(implementation.capabilities)) {
    throw new TypeError("protocol adapter capabilities must be an array");
  }
  if (typeof implementation.canHandle !== "function" || typeof implementation.describe !== "function") {
    throw new TypeError("protocol adapter canHandle/describe must be functions");
  }
  return Object.freeze({
    ...implementation,
    capabilities: Object.freeze([...new Set(implementation.capabilities)]),
  });
}

export function hasProtocolCapability(adapter, capability) {
  return Boolean(adapter?.capabilities?.includes(capability));
}

export function findProtocolAdapter(adapters, node) {
  if (!Array.isArray(adapters)) return null;
  return adapters.find((adapter) => {
    try { return adapter.canHandle(node) === true; } catch { return false; }
  }) || null;
}
