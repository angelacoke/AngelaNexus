import test from "node:test";
import assert from "node:assert/strict";
import { createCoreImportRuntime } from "../src/platform/core-import-runtime.js";

test("core import runtime delegates to the existing core import pipeline", async () => {
  let received;
  const runtime = createCoreImportRuntime({
    importer: async (input, options) => {
      received = { input, options };
      return { accepted: true };
    },
  });
  const result = await runtime.importConfiguration("vless://example", { source: "text" });
  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(received, {
    input: "vless://example",
    options: { source: "text" },
  });
});

test("core import runtime preserves local-file semantics", async () => {
  let received;
  const runtime = createCoreImportRuntime({
    importer: async (input) => { received = input; return "ok"; },
  });
  assert.equal(await runtime.importConfiguration("proxies: []", { source: "local-file", name: "config.yaml" }), "ok");
  assert.deepEqual(received, { type: "file", name: "config.yaml", content: "proxies: []" });
});
