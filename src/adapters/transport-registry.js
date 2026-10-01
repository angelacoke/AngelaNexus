import { TransportTypes, TransportCapabilities, createTransportAdapter } from "./transport-contract.js";

function describe(transport) {
  return Object.freeze({
    type: transport?.type || null,
    hasRawParameters: Boolean(transport?.raw && typeof transport.raw === "object"),
  });
}

function adapter(type) {
  return createTransportAdapter({
    type,
    capabilities: [TransportCapabilities.IDENTIFY],
    canHandle: (transport) => transport?.type === type,
    describe,
  });
}

/**
 * Built-in transport identification registry.
 *
 * This registry covers transport labels represented by the canonical model and
 * documented compatibility inputs. It only identifies an explicit transport;
 * it does not claim stream/datagram execution, TLS security, or backend support.
 */
export const builtinTransportAdapters = Object.freeze(
  Object.values(TransportTypes).map(adapter),
);

export function builtinTransportAdapterFor(type) {
  return builtinTransportAdapters.find((item) => item.type === type) || null;
}
