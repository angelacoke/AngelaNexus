import test from "node:test";
import assert from "node:assert/strict";
import {
  builtinTransportAdapters,
  builtinTransportAdapterFor,
} from "../src/adapters/transport-registry.js";
import { TransportTypes, TransportCapabilities } from "../src/adapters/transport-contract.js";

test("builtin transport registry covers every declared transport type", () => {
  assert.equal(builtinTransportAdapters.length, Object.values(TransportTypes).length);
  for (const type of Object.values(TransportTypes)) {
    const adapter = builtinTransportAdapterFor(type);
    assert.ok(adapter);
    assert.equal(adapter.type, type);
    assert.equal(adapter.capabilities.includes(TransportCapabilities.IDENTIFY), true);
  }
});

test("builtin transport adapters identify only matching transport types", () => {
  const adapter = builtinTransportAdapterFor(TransportTypes.GRPC);
  assert.equal(adapter.canHandle({ type: TransportTypes.GRPC }), true);
  assert.equal(adapter.canHandle({ type: TransportTypes.WS }), false);
});

test("builtin transport descriptions do not make execution or policy decisions", () => {
  const adapter = builtinTransportAdapterFor(TransportTypes.XHTTP);
  const description = adapter.describe({
    type: TransportTypes.XHTTP,
    raw: { mode: "stream-up" },
  });
  assert.deepEqual(description, {
    type: TransportTypes.XHTTP,
    hasRawParameters: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(description, "backend"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(description, "action"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(description, "policy"), false);
});
