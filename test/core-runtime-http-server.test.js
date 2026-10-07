import test from "node:test";
import assert from "node:assert/strict";
import { createCoreRuntimeHttpServer } from "../src/platform/core-runtime-http-server.js";

test("Core runtime HTTP server executes serialized import through the Core pipeline", async () => {
  const server = createCoreRuntimeHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "angelanexus.config-import",
        version: 1,
        source: "local-file",
        name: "test.yaml",
        content: "proxies: []",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      result: {
        version: 1,
        source: null,
        nodeCount: 0,
        kernel: "mihomo",
        detectionConfidence: "schema",
        executionIntent: null,
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server rejects oversized request bodies", async () => {
  const server = createCoreRuntimeHttpServer({ maxBytes: 8 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "123456789",
    });
    assert.equal(response.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Core runtime HTTP server preserves a canonical execution intent when Core provides one", async () => {
  const executionIntent = {
    version: 1,
    kind: "routing-execution-intent",
    mode: "proxy",
    action: "route",
    target: "node-1",
    hops: null,
    ruleIds: ["rule-1"],
    reason: "routing-policy",
    application: null,
    metadata: { source: "routing-policy" },
  };
  const server = createCoreRuntimeHttpServer({
    importer: async () => ({
      binding: { kernel: "mihomo", prompt: { reason: "schema" } },
      source: "local-file",
      model: { nodeCount: 1 },
      executionIntent,
    }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "angelanexus.config-import",
        version: 1,
        source: "local-file",
        name: "test.yaml",
        content: "proxies: []",
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.result.executionIntent, executionIntent);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
