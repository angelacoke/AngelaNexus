import test from "node:test";
import assert from "node:assert/strict";
import { importConfiguration } from "../src/core/import.js";
import { parseSubscription } from "../src/core/subscription.js";

const uuid = "11111111-1111-1111-1111-111111111111";

test("preserves VLESS UUID and TLS/WS options while ignoring transport metadata keys", () => {
  const node = parseSubscription(`vless://${uuid}@edge.example:443?security=tls&type=ws&sni=cdn.example&path=%2Fv&host=cdn.example&encryption=none#edge`)[0];
  assert.equal(node.auth.uuid, uuid);
  assert.equal(node.auth.username, uuid);
  assert.deepEqual(node.tls, { enabled: true, serverName: "cdn.example", insecure: false, alpn: [], fingerprint: null, minVersion: null, maxVersion: null, reality: null });
  assert.equal(node.transport.type, "ws");
  assert.equal(node.transport.path, "/v");
  assert.equal(node.transport.headers.Host, "cdn.example");
  assert.equal(Object.hasOwn(node, "security"), false);
  assert.equal(Object.hasOwn(node, "type"), false);
  assert.equal(Object.hasOwn(node, "encryption"), false);
});

test("maps Trojan URL password to the canonical password and username fields", () => {
  const node = parseSubscription("trojan://secret%40word@edge.example:443?security=tls#edge")[0];
  assert.equal(node.auth.username, "secret@word");
  assert.equal(node.auth.password, "secret@word");
});

test("decodes VMess base64 JSON payload and SS legacy base64 payload", () => {
  const vmess = Buffer.from(JSON.stringify({ ps: "vm", add: "vm.example", port: "443", id: uuid, net: "grpc", path: "svc", tls: "tls" })).toString("base64");
  const vm = parseSubscription(`vmess://${vmess}`)[0];
  assert.equal(vm.auth.uuid, uuid);
  assert.equal(vm.transport.type, "grpc");
  assert.equal(vm.transport.path, "svc");
  assert.equal(vm.tls.enabled, true);

  const ss = Buffer.from("aes-128-gcm:secret@ss.example:8388").toString("base64");
  const node = parseSubscription(`ss://${ss}#ss`)[0];
  assert.equal(node.protocol, "shadowsocks");
  assert.equal(node.server, "ss.example");
  assert.equal(node.port, 8388);
  assert.equal(node.auth.password, "secret");
  assert.equal(node.method, "aes-128-gcm");
});

test("imports share links end to end without dropping credentials", () => {
  const result = importConfiguration(`vless://${uuid}@edge.example:443?security=tls&type=ws&path=%2F#v\ntrojan://secret@trojan.example:443#t`);
  assert.equal(result.ok, true);
  assert.equal(result.config.nodes.length, 2);
  assert.equal(result.config.nodes[0].auth.uuid, uuid);
  assert.equal(result.config.nodes[1].auth.password, "secret");
});

test("query extensions cannot overwrite URI identity, credentials or parsed security", () => {
  const node = parseSubscription(`vless://${uuid}@edge.example:443?security=tls&type=ws&sni=cdn.example&path=%2Fsafe&server=override.example&address=override.example&port=80&server_port=80&protocol=trojan&uuid=changed&username=changed&password=changed&name=changed&id=changed&tls=false&transport=plain&auth=changed&endpoint=changed&flow=xtls-rprx-vision#trusted`)[0];
  assert.equal(node.protocol, "vless");
  assert.equal(node.server, "edge.example");
  assert.equal(node.port, 443);
  assert.deepEqual(node.endpoint, { server: "edge.example", port: 443 });
  assert.equal(node.name, "trusted");
  assert.match(node.id, /^share-[0-9a-f]+$/);
  assert.equal(node.auth.uuid, uuid);
  assert.equal(node.auth.username, uuid);
  assert.equal(node.auth.password, null);
  assert.equal(node.auth.flow, "xtls-rprx-vision");
  assert.equal(node.tls.enabled, true);
  assert.equal(node.tls.serverName, "cdn.example");
  assert.equal(node.transport.type, "ws");
  assert.equal(node.transport.path, "/safe");
});

test("query extensions cannot enable certificate bypass or replace Reality options", () => {
  const node = parseSubscription(`vless://${uuid}@edge.example:443?security=reality&sni=cdn.example&pbk=public-key&sid=abcd&tls=false&reality=disabled&allowInsecure=true&fingerprint=changed&fp=chrome`)[0];
  assert.equal(node.tls.enabled, true);
  assert.equal(node.tls.insecure, false);
  assert.equal(node.tls.fingerprint, "chrome");
  assert.equal(node.tls.reality.publicKey, "public-key");
  assert.equal(node.tls.reality.shortId, "abcd");
});

test("query prototype keys are ignored and supported extension fields survive", () => {
  const node = parseSubscription(`trojan://original@edge.example:443?security=tls&password=changed&__proto__=changed&constructor=changed&prototype=changed&customOption=retained`)[0];
  assert.equal(node.auth.password, "original");
  assert.equal(Object.hasOwn(node, "__proto__"), false);
  assert.equal(Object.hasOwn(node, "constructor"), false);
  assert.equal(Object.hasOwn(node, "prototype"), false);
  assert.equal(node.customOption, "retained");
});
