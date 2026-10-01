import test from "node:test";
import assert from "node:assert/strict";
import { NodeProtocols } from "../src/core/model.js";
import {
  builtinProtocolAdapters,
  builtinProtocolAdapterFor,
} from "../src/adapters/protocol-registry.js";
import { ProtocolCapabilities } from "../src/adapters/protocol-contract.js";

test("builtin protocol registry covers every canonical node protocol", () => {
  assert.equal(builtinProtocolAdapters.length, Object.values(NodeProtocols).length);
  for (const protocol of Object.values(NodeProtocols)) {
    const adapter = builtinProtocolAdapterFor(protocol);
    assert.ok(adapter);
    assert.equal(adapter.protocol, protocol);
    assert.equal(adapter.capabilities.includes(ProtocolCapabilities.IDENTIFY), true);
  }
});

test("builtin protocol adapters identify only matching canonical protocols", () => {
  const adapter = builtinProtocolAdapterFor(NodeProtocols.VLESS);
  assert.equal(adapter.canHandle({ protocol: NodeProtocols.VLESS }), true);
  assert.equal(adapter.canHandle({ protocol: NodeProtocols.VMESS }), false);
});

test("builtin protocol descriptions expose metadata without policy or backend decisions", () => {
  const adapter = builtinProtocolAdapterFor(NodeProtocols.VLESS);
  const description = adapter.describe({
    protocol: NodeProtocols.VLESS,
    endpoint: { server: "example.invalid", port: 443 },
    transport: { type: "ws" },
  });
  assert.deepEqual(description, {
    protocol: NodeProtocols.VLESS,
    endpoint: { server: true, port: true },
    transport: "ws",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(description, "backend"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(description, "action"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(description, "policy"), false);
});
