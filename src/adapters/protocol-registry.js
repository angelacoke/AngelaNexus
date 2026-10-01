import { NodeProtocols } from "../core/model.js";
import { createProtocolAdapter, ProtocolCapabilities } from "./protocol-contract.js";

function describe(node) {
  return Object.freeze({
    protocol: node.protocol,
    endpoint: Object.freeze({
      server: Boolean(node.endpoint?.server),
      port: Number.isFinite(node.endpoint?.port),
    }),
    transport: node.transport?.type || null,
  });
}

function adapter(protocol) {
  return createProtocolAdapter({
    protocol,
    capabilities: [ProtocolCapabilities.IDENTIFY],
    canHandle: (node) => node?.protocol === protocol,
    describe,
  });
}

/**
 * Built-in protocol identification registry.
 *
 * These adapters only identify already-canonical nodes. They do not compile
 * backend configuration, make routing decisions, or claim transport/execution
 * support that has not been negotiated separately.
 */
export const builtinProtocolAdapters = Object.freeze(
  Object.values(NodeProtocols).map(adapter),
);

export function builtinProtocolAdapterFor(protocol) {
  return builtinProtocolAdapters.find((item) => item.protocol === protocol) || null;
}
