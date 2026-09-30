import {
  CONFIG_IMPORT_ENVELOPE_MAX_BYTES,
  CONFIG_IMPORT_ENVELOPE_TYPE,
  createCoreImportReceiver,
  parseConfigImportEnvelope,
} from "../src/platform/index.js";
import assert from "node:assert/strict";
import test from "node:test";

test("platform index exposes the runtime import receiver contract", async () => {
  assert.equal(CONFIG_IMPORT_ENVELOPE_TYPE, "angelanexus.config-import");
  assert.equal(CONFIG_IMPORT_ENVELOPE_MAX_BYTES, 5 * 1024 * 1024);

  const payload = JSON.stringify({
    type: CONFIG_IMPORT_ENVELOPE_TYPE,
    version: 1,
    source: "local-file",
    name: "profile.yaml",
    content: "mixed-port: 7890",
  });

  assert.deepEqual(parseConfigImportEnvelope(payload), {
    version: 1,
    source: "local-file",
    name: "profile.yaml",
    content: "mixed-port: 7890",
  });

  const received = [];
  const receiver = createCoreImportReceiver({
    importer: async (input, options) => {
      received.push({ input, options });
      return { result: { accepted: true } };
    },
  });

  const result = await receiver.receive(payload, { platform: "android" });
  assert.deepEqual(result, { result: { accepted: true } });
  assert.deepEqual(received, [{
    input: {
      type: "file",
      content: "mixed-port: 7890",
      name: "profile.yaml",
    },
    options: {
      platform: "android",
      source: "local-file",
      name: "profile.yaml",
    },
  }]);
});
