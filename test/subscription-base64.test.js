import test from "node:test";
import assert from "node:assert/strict";
import { parseSubscription, parseSubscriptionDocument } from "../src/core/subscription.js";
import { sniff } from "../src/core/sniffer.js";

const yaml = "proxies:\n  - name: encoded\n    type: socks5\n    server: encoded.example\n    port: 1080\n";

function base64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

test("parses one Base64 layer containing a YAML subscription", () => {
  const encoded = base64(yaml);
  assert.equal(parseSubscription(encoded).length, 1);
  assert.equal(parseSubscription(encoded)[0].name, "encoded");
  assert.equal(sniff(encoded).kernel, "mihomo");
});

test("parses one Base64 layer containing share links", () => {
  const encoded = base64("vless://user@example.com:443?security=tls#encoded");
  const document = parseSubscriptionDocument(encoded);
  assert.equal(document.kind, "share-links");
  assert.equal(parseSubscription(encoded)[0].server, "example.com");
  assert.equal(sniff(encoded).kind, "share-link");
});

test("does not accept decoded YAML scalar as a structured subscription", () => {
  assert.throws(() => parseSubscription(base64("just a scalar")), /unsupported subscription format/);
});

test("does not treat URLs inside a raw JSON document as share-link input", () => {
  const input = JSON.stringify({ description: "vless://user@example.com:443#not-a-list" });
  const document = parseSubscriptionDocument(input);
  assert.equal(document.kind, "structured");
  assert.deepEqual(document.value, { description: "vless://user@example.com:443#not-a-list" });
});

test("preserves method and password from a plaintext SS share link", () => {
  const node = parseSubscription("ss://aes-128-gcm:pass@example.com:8388#ss")[0];
  assert.equal(node.method, "aes-128-gcm");
  assert.equal(node.auth.password, "pass");
});

test("keeps JSON format identity and ignores share links inside structured metadata", () => {
  const input = JSON.stringify({ routing: {}, outbounds: [], inbounds: [], description: " vless://user@example.com:443" });
  assert.equal(sniff(input).kind, "json");
  assert.equal(sniff(input).kernel, "xray");
  assert.equal(sniff(JSON.stringify({ description: " vless://user@example.com:443" })).protocol, undefined);
});

test("does not recursively decode nested Base64 subscriptions", () => {
  assert.throws(() => parseSubscription(base64(base64(yaml))), /unsupported subscription format/);
  assert.equal(sniff(base64(base64(yaml))).kind, "unknown");
});
