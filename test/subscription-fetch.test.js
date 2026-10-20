import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { fetchSubscription } from "../src/core/subscription.js";
import { importSource } from "../src/core/import-pipeline.js";
import { importConfigurationAsync } from "../src/core/import.js";

const url = "https://source.example/subscription";
const never = () => new Promise(() => {});
const timeout = (error) => error.name === "TimeoutError" && error.code === "SUBSCRIPTION_TIMEOUT";

test("subscription download has a deadline even when a fetcher ignores its signal", async () => {
  let signal;
  await assert.rejects(fetchSubscription(url, {
    timeoutMs: 30,
    fetcher: (_, options) => { signal = options.signal; return never(); },
  }), timeout);
  assert.equal(signal.aborted, true);
});

test("subscription deadline covers stalled streaming bodies and non-cooperative cleanup", async () => {
  let cancelled = false;
  await assert.rejects(fetchSubscription(url, {
    timeoutMs: 30,
    fetcher: async () => ({ ok: true, status: 200, body: { getReader: () => ({
      read: never,
      cancel: () => { cancelled = true; return never(); },
      releaseLock() {},
    }) } }),
  }), timeout);
  assert.equal(cancelled, true);
});

test("subscription deadline also covers text-only custom fetch responses", async () => {
  await assert.rejects(fetchSubscription(url, {
    timeoutMs: 30,
    fetcher: async () => ({ ok: true, status: 200, text: never }),
  }), timeout);
});

test("already cancelled imports do not start network requests", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(fetchSubscription(url, {
    signal: controller.signal,
    fetcher: async () => { calls += 1; return new Response("unused"); },
  }), { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("caller cancellation interrupts reads and removes its event listener", async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let cancelled = false;
  const download = fetchSubscription(url, {
    signal: controller.signal,
    fetcher: async () => new Response(new ReadableStream({
      pull() { started(); return never(); },
      cancel() { cancelled = true; },
    })),
  });
  await ready;
  controller.abort();
  await assert.rejects(download, { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("late custom fetch responses are cancelled after the deadline", async () => {
  let resolveResponse;
  let cancelled = false;
  await assert.rejects(fetchSubscription(url, {
    timeoutMs: 30,
    fetcher: () => new Promise((resolve) => { resolveResponse = resolve; }),
  }), timeout);
  resolveResponse(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("redirect responses are cancelled and share one download abort signal", async () => {
  let cancelled = false;
  const signals = [];
  const response = await fetchSubscription(url, {
    fetcher: async (_, options) => {
      signals.push(options.signal);
      if (signals.length === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status: 302, headers: { location: "/next" },
      });
      return new Response("proxies: []");
    },
  });
  assert.equal(response, "proxies: []");
  assert.equal(cancelled, true);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
});

test("rejected redirect destinations still release the response body", async () => {
  let cancelled = false;
  await assert.rejects(fetchSubscription(url, {
    fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 302, headers: { location: "file:///private/config" },
    }),
  }), /must use http or https/);
  assert.equal(cancelled, true);
});

test("HTTP error responses release their bodies without exposing remote content", async () => {
  let cancelled = false;
  await assert.rejects(fetchSubscription(url, {
    fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 }),
  }), /subscription download failed/);
  assert.equal(cancelled, true);
});

test("declared oversized subscriptions are rejected without reading the body", async () => {
  let read = false;
  let cancelled = false;
  await assert.rejects(fetchSubscription(url, {
    maxBytes: 8,
    fetcher: async () => ({ ok: true, status: 200,
      headers: new Map([["content-length", "9"]]),
      body: { getReader() { read = true; }, cancel() { cancelled = true; } },
    }),
  }), /exceeds size limit/);
  assert.equal(read, false);
  assert.equal(cancelled, true);
});

test("chunked subscriptions are bounded and release reader locks on failure", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(9)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(fetchSubscription(url, { maxBytes: 8, fetcher: async () => response }), /exceeds size limit/);
  assert.equal(cancelled, true);
  assert.equal(response.body.locked, false);
});

test("successful subscriptions release locks and caller listeners", async () => {
  const controller = new AbortController();
  const response = new Response("中文配置");
  assert.equal(await fetchSubscription(url, { signal: controller.signal, fetcher: async () => response }), "中文配置");
  assert.equal(response.body.locked, false);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("invalid UTF-8 cannot silently change subscription credentials", async () => {
  await assert.rejects(fetchSubscription(url, {
    fetcher: async () => new Response(new Uint8Array([0xc3, 0x28])),
  }), /not valid UTF-8/);
});

test("zero-byte subscription limits permit only empty content", async () => {
  assert.equal(await fetchSubscription(url, { maxBytes: 0, fetcher: async () => new Response("") }), "");
  await assert.rejects(fetchSubscription(url, { maxBytes: 0, fetcher: async () => new Response("x") }), /size limit/);
});

test("subscription deadline and signal options are validated before fetching", async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 2147483648]) {
    await assert.rejects(fetchSubscription(url, { timeoutMs }), /timeoutMs must be an integer/);
  }
  await assert.rejects(fetchSubscription(url, { signal: {} }), /signal must be an AbortSignal/);
});

test("all URL import entry points forward timeout and cancellation options", async () => {
  for (const importer of [importSource, importConfigurationAsync]) {
    for (const input of [url, { type: "url", url }]) {
      await assert.rejects(importer(input, { timeoutMs: 20, fetcher: never }), timeout);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(importer(input, { signal: controller.signal, fetcher: never }), { name: "AbortError" });
    }
  }
});

test("unified importSource forwards the configured byte limit", async () => {
  await assert.rejects(importSource(url, { maxBytes: 1, fetcher: async () => new Response("proxies: []") }), /exceeds size limit/);
});

test("text-only compatibility fetchers are checked after materializing their text", async () => {
  let materialized = false;
  await assert.rejects(fetchSubscription(url, {
    maxBytes: 1,
    fetcher: async () => ({ ok: true, status: 200, text: async () => {
      materialized = true;
      return "x".repeat(1024 * 1024);
    } }),
  }), /exceeds size limit/);
  // This fallback is for trusted adapters, not a streaming memory boundary.
  assert.equal(materialized, true);
});

test("tiny subscription chunks do not retain per-chunk abort listeners", async () => {
  let signal;
  let reads = 0;
  let maxListeners = 0;
  const response = await fetchSubscription(url, {
    fetcher: async (_, options) => {
      signal = options.signal;
      return { ok: true, status: 200, body: { getReader: () => ({
        async read() {
          maxListeners = Math.max(maxListeners, getEventListeners(signal, "abort").length);
          reads += 1;
          return reads <= 1024 ? { done: false, value: new Uint8Array([120]) } : { done: true };
        },
        cancel() {}, releaseLock() {},
      }) } };
    },
  });
  assert.equal(response.length, 1024);
  assert.ok(maxListeners <= 1);
  assert.equal(getEventListeners(signal, "abort").length, 0);
});
