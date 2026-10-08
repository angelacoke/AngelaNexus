import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeImportService } from "../src/platform/runtime-import-service.js";

test("runtime import service delegates validated envelopes to the core importer", async () => {
  const calls = [];
  const service = createRuntimeImportService({
    importer: async (input, options) => {
      calls.push({ input, options });
      return { accepted: true };
    },
  });

  const result = await service.receive(JSON.stringify({
    type: "angelanexus.config-import",
    version: 1,
    source: "text",
    name: "single-node.txt",
    content: "vless://example",
  }), { platform: "android" });

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls, [{
    input: "vless://example",
    options: { platform: "android", prepareRuntimeHandoff: true, source: "text", name: "single-node.txt" },
  }]);
});
