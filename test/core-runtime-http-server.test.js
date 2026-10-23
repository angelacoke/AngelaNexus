import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createCoreRuntimeHttpServer } from "../src/platform/core-runtime-http-server.js";

function tcpExchange(port, writes, waitMs = 0) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2_000);
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("TCP test timed out")));
    socket.on("close", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("latin1"));
    });
    socket.on("connect", async () => {
      try {
        for (const [text, delay] of writes) {
          socket.write(text);
          if (delay) await new Promise((r) => setTimeout(r, delay));
        }
        if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
        socket.end();
      } catch (error) { fail(error); }
    });
  });
}

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
        configuration: null,
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

test("Core runtime HTTP server accepts JSON parameters but rejects lookalike media types", async () => {
  const server = createCoreRuntimeHttpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const accepted = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: "{}",
    });
    assert.equal(accepted.status, 400);

    const rejected = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/jsonp" },
      body: "{}",
    });
    assert.equal(rejected.status, 415);
    assert.deepEqual(await rejected.json(), { ok: false, error: "unsupported-content-type" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server rejects a declared oversized body before buffering it", async () => {
  const server = createCoreRuntimeHttpServer({ maxBytes: 8 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "9" },
      body: "123456789",
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { ok: false, error: "request body exceeds byte limit" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server returns 413 for oversized chunked uploads", async () => {
  const server = createCoreRuntimeHttpServer({ maxBytes: 8 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  async function* chunks() {
    yield "1234";
    yield "56789";
  }
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/v1/runtime/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: chunks(),
      duplex: "half",
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server validates bodyTimeoutMs", () => {
  assert.throws(() => createCoreRuntimeHttpServer({ bodyTimeoutMs: 0 }), /bodyTimeoutMs/);
  assert.throws(() => createCoreRuntimeHttpServer({ bodyTimeoutMs: -1 }), /bodyTimeoutMs/);
  assert.throws(() => createCoreRuntimeHttpServer({ bodyTimeoutMs: 1.5 }), /bodyTimeoutMs/);
  assert.throws(() => createCoreRuntimeHttpServer({ bodyTimeoutMs: 2_147_483_648 }), /bodyTimeoutMs/);
});

test("Core runtime HTTP server times out a real TCP partial Content-Length upload", async () => {
  const server = createCoreRuntimeHttpServer({ bodyTimeoutMs: 60 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await tcpExchange(port, [[
      "POST /v1/runtime/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: keep-alive\r\n\r\n{",
      0,
    ]], 120);
    assert.match(response, /^HTTP\/1\.1 408 /);
    assert.match(response, /Connection: close/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server times out a real TCP chunked drip", async () => {
  const server = createCoreRuntimeHttpServer({ bodyTimeoutMs: 150 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await tcpExchange(port, [
      ["POST /v1/runtime/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n1\r\nx\r\n", 60],
      ["1\r\ny\r\n", 60],
      ["1\r\nz\r\n", 120],
    ]);
    assert.match(response, /^HTTP\/1\.1 408 /);
    assert.match(response, /Connection: close/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server keeps a completed keep-alive connection usable", async () => {
  const server = createCoreRuntimeHttpServer({ bodyTimeoutMs: 500 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const body = JSON.stringify({
    type: "angelanexus.config-import", version: 1, source: "local-file",
    name: "test.yaml", content: "proxies: []",
  });
  const request = `POST /v1/runtime/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: keep-alive\r\n\r\n${body}`;
  try {
    const response = await tcpExchange(port, [[request, 550], [request, 20]]);
    assert.equal((response.match(/HTTP\/1\.1 200/g) || []).length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Core runtime HTTP server tolerates a client interrupt during body read", async () => {
  const server = createCoreRuntimeHttpServer({ bodyTimeoutMs: 150 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end("POST /v1/runtime/import HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 20\r\nConnection: close\r\n\r\n{");
        socket.destroy();
        resolve();
      });
      socket.once("error", (error) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
