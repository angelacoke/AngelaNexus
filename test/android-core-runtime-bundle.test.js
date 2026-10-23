import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundlePath = new URL("../native/android/app/src/main/assets/angelanexus-core.bundle.js", import.meta.url);
let bundle;
function createRuntime() {
  if (!bundle) {
    execFileSync(process.execPath, ["scripts/build-android-core-bundle.mjs"], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    });
    bundle = readFileSync(bundlePath, "utf8");
  }
  assert.ok(bundle.length > 0);
  const context = {
    console, TextEncoder, TextDecoder, Uint8Array, DataView, URL,
    structuredClone, atob, btoa, setTimeout, clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { timeout: 20_000 });
  assert.equal(context.angelanexusCoreRuntimeReady, true);
  return context;
}

async function importContent(context, content, name = "smoke.yaml") {
  const envelope = JSON.stringify({
    type: "angelanexus.config-import", version: 1, source: "local-file", name, content,
  });
  return JSON.parse(await context.angelanexusCoreImport(envelope));
}

const profile = "proxies:\n  - name: smoke\n    type: socks5\n    server: us.example\n    port: 1080\n";

test("Android bundle executes the canonical Core import pipeline", async () => {
  const result = await importContent(createRuntime(), profile);
  assert.equal(result.ok, true);
  assert.equal(result.result.source, "local-file");
  assert.equal(result.result.nodeCount, 1);
  assert.equal(result.result.kernel, "mihomo");
  assert.equal(result.result.detectionConfidence, "schema");
});

test("Android Core buffer shim round-trips UTF-8 and Base64 without Node globals", () => {
  const context = createRuntime();
  const text = "AngelaNexus 中文配置";
  const encoded = Buffer.from(text).toString("base64");
  assert.equal(context.Buffer.from(encoded, "base64").toString("utf8"), text);
  assert.equal(context.Buffer.from(text).toString("base64"), encoded);
  assert.equal(context.Buffer.from(encoded.replace(/.{8}/g, "$&\n"), "base64").toString(), text);
  assert.equal(context.Buffer.concat([context.Buffer.from("中"), context.Buffer.from("文")]).toString(), "中文");
  assert.equal(context.Buffer.byteLength("中文"), 6);
});

test("Android Core imports a Base64 structured profile without corrupting decoded text", async () => {
  const result = await importContent(createRuntime(), Buffer.from(profile).toString("base64"), "encoded.txt");
  assert.equal(result.ok, true);
  assert.equal(result.result.nodeCount, 1);
});

test("Android Core decodes VMess payloads using the existing URL API", async () => {
  const payload = Buffer.from(JSON.stringify({
    ps: "vmess-fixture", add: "edge.example", port: "443",
    id: "11111111-1111-4111-8111-111111111111", net: "grpc", path: "fixture-service", tls: "tls",
  })).toString("base64");
  const result = await importContent(createRuntime(), `vmess://${payload}`, "vmess.txt");
  assert.equal(result.ok, true);
  assert.equal(result.result.nodeCount, 1);
});
