import test from "node:test";
import assert from "node:assert/strict";
import {
  PlatformId,
  PlatformCapabilities,
  createPlatformBridge,
  createConfigImportAdapter,
} from "../src/platform/index.js";

test("platform bridge forwards lifecycle operations", async () => {
  const calls = [];
  const bridge = createPlatformBridge({
    platform: PlatformId.LINUX,
    capabilities: [],
    async start() { calls.push("start"); },
    async stop() { calls.push("stop"); },
    getNetworkState() { return { online: true }; },
  });
  assert.deepEqual(await bridge.start(), { online: true });
  assert.deepEqual(await bridge.stop(), { online: true });
  assert.deepEqual(calls, ["start", "stop"]);
});

test("platform bridge exposes only declared capability operations", async () => {
  const calls = [];
  const bridge = createPlatformBridge({
    platform: PlatformId.ANDROID,
    capabilities: [PlatformCapabilities.TUN],
    async start() {},
    async stop() {},
    getNetworkState() { return { online: true }; },
    async startTun(options) { calls.push(["startTun", options]); return "tun-started"; },
    async stopTun() { calls.push(["stopTun"]); return "tun-stopped"; },
  });
  assert.equal(await bridge.startTun({ mtu: 1500 }), "tun-started");
  assert.equal(await bridge.stopTun(), "tun-stopped");
  assert.deepEqual(calls, [["startTun", { mtu: 1500 }], ["stopTun"]]);
  await assert.rejects(() => bridge.setSystemProxy({ enabled: true }), /capability unavailable: system-proxy/);
});

test("network monitor validates listener before native bridge call", async () => {
  const bridge = createPlatformBridge({
    platform: PlatformId.WINDOWS,
    capabilities: [PlatformCapabilities.NETWORK_MONITOR],
    async start() {}, async stop() {}, getNetworkState() { return { online: true }; },
    async subscribeNetworkState(listener) { return listener({ online: false }); },
  });
  await assert.rejects(() => bridge.subscribeNetworkState(null), /listener must be a function/);
  let state;
  await bridge.subscribeNetworkState((value) => { state = value; });
  assert.deepEqual(state, { online: false });
});

test("secure storage capability is never silently substituted", async () => {
  const bridge = createPlatformBridge({ platform: PlatformId.MACOS, capabilities: [], async start() {}, async stop() {}, getNetworkState() { return { online: true }; } });
  await assert.rejects(() => bridge.getSecureValue("token"), /capability unavailable: secure-storage/);
});

test("configuration import capability forwards the selected source without substitution", async () => {
  const calls = [];
  const bridge = createPlatformBridge({
    platform: PlatformId.ANDROID,
    capabilities: [PlatformCapabilities.CONFIG_IMPORT],
    async start() {}, async stop() {}, getNetworkState() { return { online: true }; },
    async importConfiguration(input, options) { calls.push([input, options]); return { accepted: true }; },
  });
  assert.deepEqual(await bridge.importConfiguration("config-text", { source: "local-file" }), { accepted: true });
  assert.deepEqual(calls, [["config-text", { source: "local-file" }]]);
});

test("configuration import capability remains unavailable unless explicitly declared", async () => {
  const bridge = createPlatformBridge({ platform: PlatformId.IOS, capabilities: [], async start() {}, async stop() {}, getNetworkState() { return { online: true }; } });
  await assert.rejects(() => bridge.importConfiguration("config-text"), /capability unavailable: config-import/);
});

test("configuration import envelope is versioned and source-explicit", async () => {
  const adapter = createConfigImportAdapter({ importer: async (input) => ({ input }) });
  const result = await adapter.importConfiguration("vless://example", { source: "text", name: "node.txt" });
  assert.equal(result.version, 1);
  assert.equal(result.source, "text");
  assert.equal(result.name, "node.txt");
  assert.deepEqual(result.result, { input: "vless://example" });
  assert.equal(Object.isFrozen(result), true);
});

test("local-file import preserves the file source for the core importer", async () => {
  let received;
  const adapter = createConfigImportAdapter({ importer: async (input) => { received = input; return "ok"; } });
  await adapter.importConfiguration("proxies: []", { source: "local-file", name: "config.yaml" });
  assert.deepEqual(received, { type: "file", name: "config.yaml", content: "proxies: []" });
});
