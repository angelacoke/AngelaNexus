export const TransportTypes = Object.freeze({
  TCP: "tcp",
  UDP: "udp",
  TLS: "tls",
  QUIC: "quic",
  HTTP: "http",
});

export const TransportCapabilities = Object.freeze({
  STREAM: "stream",
  DATAGRAM: "datagram",
  SECURE: "secure",
});

const REQUIRED = ["type", "capabilities", "canHandle", "describe"];

export function createTransportAdapter(implementation) {
  if (!implementation || typeof implementation !== "object") throw new TypeError("transport adapter is required");
  for (const key of REQUIRED) {
    if (typeof implementation[key] === "undefined") throw new TypeError("transport adapter missing: " + key);
  }
  if (!Object.values(TransportTypes).includes(implementation.type)) {
    throw new TypeError("unsupported transport type: " + implementation.type);
  }
  if (!Array.isArray(implementation.capabilities)) {
    throw new TypeError("transport adapter capabilities must be an array");
  }
  if (typeof implementation.canHandle !== "function" || typeof implementation.describe !== "function") {
    throw new TypeError("transport adapter canHandle/describe must be functions");
  }
  return Object.freeze({
    ...implementation,
    capabilities: Object.freeze([...new Set(implementation.capabilities)]),
  });
}

export function hasTransportCapability(adapter, capability) {
  return Boolean(adapter?.capabilities?.includes(capability));
}

export function findTransportAdapter(adapters, transport) {
  if (!Array.isArray(adapters)) return null;
  return adapters.find((adapter) => {
    try { return adapter.canHandle(transport) === true; } catch { return false; }
  }) || null;
}
