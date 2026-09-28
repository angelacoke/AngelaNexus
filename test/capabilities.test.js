import test from "node:test";
import assert from "node:assert/strict";
import { Kernels, NodeProtocols } from "../src/core/model.js";
import { NodeCapabilities, evaluateNodeCapabilities } from "../src/core/capabilities.js";

test("capability evaluation is kernel-aware", () => {
  const node = {
    protocol: "vless",
    endpoint: { server: "example.com", port: 443 },
    udp: true,
    tls: { enabled: true, reality: { enabled: true } },
    transport: { type: "ws" },
  };
  const result = evaluateNodeCapabilities(node, Kernels.MIHOMO);
  assert.equal(result.ok, true);
  assert.ok(result.data.capabilities.includes(NodeCapabilities.TLS));
  assert.ok(result.data.capabilities.includes(NodeCapabilities.REALITY));
  assert.ok(result.data.capabilities.includes(NodeCapabilities.WEBSOCKET));
  assert.ok(result.data.capabilities.includes(NodeCapabilities.UDP));
});

test("unsupported protocol is explicit", () => {
  const result = evaluateNodeCapabilities({ protocol: "anytls" }, Kernels.XRAY);
  assert.equal(result.ok, false);
  assert.deepEqual(result.data.unsupported, ["protocol:anytls"]);
});

test("unknown kernel is rejected", () => {
  const result = evaluateNodeCapabilities({ protocol: "vless" }, "unknown");
  assert.equal(result.ok, false);
});


test("sing-box WireGuard capability is explicitly unsupported", () => {
  const result = evaluateNodeCapabilities({ protocol: NodeProtocols.WIREGUARD }, Kernels.SING_BOX);
  assert.equal(result.ok, false);
  assert.deepEqual(result.data.unsupported, ["protocol:wireguard"]);
});
