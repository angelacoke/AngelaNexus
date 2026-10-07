import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const bundlePath = new URL("../native/android/app/src/main/assets/angelanexus-core.bundle.js", import.meta.url);

test("Android bundle executes the canonical Core import pipeline", async () => {
  execFileSync(process.execPath, ["scripts/build-android-core-bundle.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: "pipe"
  });

  const bundle = readFileSync(bundlePath, "utf8");
  assert.ok(bundle.length > 0);

  const context = {
    console,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    DataView,
    URL,
    structuredClone,
    atob,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.runInNewContext(bundle, context, { timeout: 20_000 });

  assert.equal(context.angelanexusCoreRuntimeReady, true);

  const envelope = JSON.stringify({
    type: "angelanexus.config-import",
    version: 1,
    source: "local-file",
    name: "smoke.yaml",
    content: "proxies:\n  - name: smoke\n    type: socks5\n    server: example.com\n    port: 1080\n"
  });
  const result = JSON.parse(await context.angelanexusCoreImport(envelope));

  assert.equal(result.ok, true);
  assert.equal(result.result.source, "local-file");
  assert.equal(result.result.nodeCount, 1);
  assert.equal(result.result.kernel, "mihomo");
  assert.equal(result.result.detectionConfidence, "schema");
});
