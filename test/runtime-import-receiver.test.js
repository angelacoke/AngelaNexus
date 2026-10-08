import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_IMPORT_ENVELOPE_TYPE,
  createCoreImportReceiver,
  parseConfigImportEnvelope,
} from "../src/platform/runtime-import-receiver.js";

function envelope(overrides = {}) {
  return JSON.stringify({
    type: CONFIG_IMPORT_ENVELOPE_TYPE,
    version: 1,
    source: "local-file",
    name: "profile.yaml",
    content: "mixed-port: 7890",
    ...overrides,
  });
}

test("parses the Android-compatible import envelope without interpreting configuration syntax", () => {
  const request = parseConfigImportEnvelope(envelope());

  assert.deepEqual(request, {
    version: 1,
    source: "local-file",
    name: "profile.yaml",
    content: "mixed-port: 7890",
  });
});

test("rejects invalid envelope identity and malformed JSON", () => {
  assert.throws(
    () => parseConfigImportEnvelope(envelope({ type: "other" })),
    /unsupported configuration import envelope type/
  );
  assert.throws(
    () => parseConfigImportEnvelope("{"),
    /not valid JSON/
  );
});

test("rejects unsupported sources, empty content and invalid names", () => {
  assert.throws(
    () => parseConfigImportEnvelope(envelope({ source: "unknown" })),
    /unsupported configuration import source/
  );
  assert.throws(
    () => parseConfigImportEnvelope(envelope({ content: "" })),
    /content must be non-empty/
  );
  assert.throws(
    () => parseConfigImportEnvelope(envelope({ name: "x".repeat(256) })),
    /name is invalid/
  );
});

test("enforces the serialized envelope byte limit", () => {
  assert.throws(
    () => parseConfigImportEnvelope(envelope({ content: "x".repeat(100) }), { maxBytes: 32 }),
    /exceeds byte limit/
  );
});

test("preserves an explicit traffic acceptance policy through the receiver", async () => {
  const calls = [];
  const receiver = createCoreImportReceiver({
    importer: async (input, options) => {
      calls.push({ input, options });
      return { ok: true };
    },
  });

  await receiver.receive(envelope({
    trafficAcceptance: {
      required: true,
      targetUrl: "https://example.test/health",
      timeoutMs: 7000,
    },
  }));

  assert.deepEqual(calls[0].options.trafficAcceptance, {
    required: true,
    targetUrl: "https://example.test/health",
    timeoutMs: 7000,
  });
});

test("rejects plaintext traffic acceptance targets", () => {
  assert.throws(
    () => parseConfigImportEnvelope(envelope({
      trafficAcceptance: { required: true, targetUrl: "http://example.test/health" },
    })),
    /must use HTTPS/
  );
});

test("receiver delegates the bounded request to the core import pipeline", async () => {
  const calls = [];
  const receiver = createCoreImportReceiver({
    importer: async (input, options) => {
      calls.push({ input, options });
      return { ok: true };
    },
  });

  const result = await receiver.receive(envelope());

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{
    input: { type: "file", name: "profile.yaml", content: "mixed-port: 7890" },
    options: { source: "local-file", name: "profile.yaml", prepareRuntimeHandoff: true, trafficAcceptance: null },
  }]);
});
