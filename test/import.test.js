import test from "node:test";
import assert from "node:assert/strict";
import { importConfiguration } from "../src/core/import.js";

test("imports Mihomo YAML and binds the detected kernel", () => {
  const result = importConfiguration("proxies:\n  - name: US-1\n    type: socks5\n    server: us.example\n    port: 1080");
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.detection.kernel, "mihomo");
  assert.equal(result.config.kernel, "mihomo");
  assert.equal(result.config.nodes.length, 1);
});

test("keeps ambiguous inbounds/outbounds schemas unbound", () => {
  const result = importConfiguration(JSON.stringify({
    inbounds: [],
    outbounds: [{ tag: "us-1", type: "vless", server: "us.example", server_port: 443 }]
  }));
  assert.equal(result.ok, true);
  assert.equal(result.status, "kernel-selection-required");
  assert.equal(result.detection.kernel, null);
  assert.deepEqual(result.detection.candidates, ["sing-box", "xray"]);
  assert.equal(result.config.kernel, null);
});

test("imports a share link without inventing a kernel", () => {
  const result = importConfiguration("vless://user@example.com:443?security=tls#US");
  assert.equal(result.ok, true);
  assert.equal(result.status, "kernel-selection-required");
  assert.equal(result.config.nodes.length, 1);
  assert.equal(result.config.nodes[0].protocol, "vless");
});

test("does not copy source content into import metadata", () => {
  const result = importConfiguration({ name: "private-config", content: "vless://secret@example.com:443#US" });
  assert.equal(result.config.metadata.sourceName, "private-config");
  assert.equal(Object.prototype.hasOwnProperty.call(result.config.metadata, "content"), false);
});
