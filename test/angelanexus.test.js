import { normalizeNode, normalizeNodes } from "../src/core/model.js";
import test from "node:test";
import assert from "node:assert/strict";
import { sniff } from "../src/core/sniffer.js";

test("canonical node identity never becomes authentication", () => {
  const node = normalizeNode({ id: "node-1", name: "US 1", type: "vless", server: "example.com", port: 443 });
  assert.equal(node.id, "node-1");
  assert.equal(node.auth.uuid, null);
});

test("canonical auth accepts nested auth without confusing id", () => {
  const node = normalizeNode({ id: "node-1", protocol: "vless", server: "example.com", port: 443, auth: { uuid: "550e8400-e29b-41d4-a716-446655440000", flow: "xtls-rprx-vision" } });
  assert.equal(node.auth.uuid, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(node.auth.flow, "xtls-rprx-vision");
});

test("canonical model deduplicates equivalent nodes but preserves distinct credentials", () => {
  const nodes = normalizeNodes([
    { name: "a", protocol: "vless", server: "example.com", port: 443, uuid: "u1" },
    { name: "b", protocol: "vless", server: "example.com", port: 443, uuid: "u1" },
    { name: "c", protocol: "vless", server: "example.com", port: 443, uuid: "u2" }
  ]);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(n => n.auth.uuid), ["u1", "u2"]);
});

test("canonical model keeps explicit user node count policy separate from normalization", () => {
  const nodes = normalizeNodes([
    { name: "a", protocol: "vless", server: "a.example", port: 443, uuid: "1" },
    { name: "b", protocol: "vless", server: "b.example", port: 443, uuid: "2" },
    { name: "c", protocol: "vless", server: "c.example", port: 443, uuid: "3" }
  ]);
  assert.equal(nodes.length, 3);
});

test("sniff share link resolves all verified native runtimes for the protocol", () => {
  const result = sniff("vless://example");
  assert.equal(result.kernel, null);
  assert.deepEqual(result.candidates, ["mihomo", "sing-box", "xray"]);
  assert.equal(result.confidence, "protocol-multi-runtime");
});

test("binds Clash YAML to Mihomo", () => {
  const result = sniff("proxies:\n  - name: us\n    type: vless");
  assert.equal(result.kernel, "mihomo");
  assert.equal(result.kind, "clash-yaml");
});

test("binds sing-box JSON by route schema", () => {
  const result = sniff(JSON.stringify({ inbounds: [], outbounds: [], route: { rules: [] } }));
  assert.equal(result.kernel, "sing-box");
});

test("binds Xray JSON by routing schema", () => {
  const result = sniff(JSON.stringify({ inbounds: [], outbounds: [], routing: { rules: [] } }));
  assert.equal(result.kernel, "xray");
});
