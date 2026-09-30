import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuntimeConfigImportTransport,
  serializeConfigImportRequest,
  RUNTIME_IMPORT_MAX_BYTES,
} from "../src/platform/runtime-import.js";

test("runtime import serialization uses a versioned explicit envelope", () => {
  const payload = serializeConfigImportRequest({
    version: 1,
    source: "local-file",
    name: "config.yaml",
    content: "proxies: []",
  });
  assert.deepEqual(JSON.parse(payload), {
    type: "angelanexus.config-import",
    version: 1,
    source: "local-file",
    name: "config.yaml",
    content: "proxies: []",
  });
});

test("runtime import serialization rejects unsupported sources", () => {
  assert.throws(() => serializeConfigImportRequest({ version: 1, source: "unknown", name: null, content: "x" }), /unsupported runtime import source/);
});

test("runtime import serialization enforces a byte limit", () => {
  assert.throws(
    () => serializeConfigImportRequest({ version: 1, source: "text", name: null, content: "x" }, { maxBytes: 10 }),
    /exceeds byte limit/,
  );
});

test("runtime import transport sends only the validated serialized envelope", async () => {
  let sent;
  const transport = createRuntimeConfigImportTransport({ send: async (payload) => { sent = payload; return "accepted"; } });
  assert.equal(await transport.importConfiguration({ version: 1, source: "text", name: null, content: "vless://example" }), "accepted");
  assert.deepEqual(JSON.parse(sent), {
    type: "angelanexus.config-import",
    version: 1,
    source: "text",
    name: null,
    content: "vless://example",
  });
});

test("runtime import default limit is aligned with the bounded native reader", () => {
  assert.equal(RUNTIME_IMPORT_MAX_BYTES, 5 * 1024 * 1024);
});
