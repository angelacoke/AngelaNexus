import test from "node:test";
import assert from "node:assert/strict";
import {
  PlatformId,
  PlatformCapabilities,
  createPlatformBridge,
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
  assert.deepEqual(calls, [
    ["startTun", { mtu: 1500 }],
    ["stopTun"],
  ]);
  await assert.rejects(
    () => bridge.setSystemProxy({ enabled: true }),
    /capability unavailable: system-proxy/,
  );
});

test("network monitor validates listener before native bridge call", async () => {
  const bridge = createPlatformBridge({
    platform: PlatformId.WINDOWS,
    capabilities: [PlatformCapabilities.NETWORK_MONITOR],
    async start() {},
    async stop() {},
    getNetworkState() { return { online: true }; },
    async subscribeNetworkState(listener) { return listener({ online: false }); },
  });

  await assert.rejects(
    () => bridge.subscribeNetworkState(null),
    /listener must be a function/,
  );

  let state;
  await bridge.subscribeNetworkState((value) => { state = value; });
  assert.deepEqual(state, { online: false });
});

test("secure storage capability is never silently substituted", async () => {
  const bridge = createPlatformBridge({
    platform: PlatformId.MACOS,
    capabilities: [],
    async start() {},
    async stop() {},
    getNetworkState() { return { online: true }; },
  });

  await assert.rejects(
    () => bridge.getSecureValue("token"),
    /capability unavailable: secure-storage/,
  );
});


test("configuration import capability forwards the selected source without substitution", async () => {
  const calls = [];
  const bridge = createPlatformBridge({
    platform: PlatformId.ANDROID,
    capabilities: [PlatformCapabilities.CONFIG_IMPORT],
    async start() {},
    async stop() {},
    getNetworkState() { return { online: true }; },
    async importConfiguration(input, options) {
      calls.push([input, options]);
      return { accepted: true };
    },
  });

  assert.deepEqual(await bridge.importConfiguration("config-text", { source: "local-file" }), { accepted: true });
  assert.deepEqual(calls, [["config-text", { source: "local-file" }]]);
});

test("configuration import capability remains unavailable unless explicitly declared", async () => {
  const bridge = createPlatformBridge({
    platform: PlatformId.IOS,
    capabilities: [],
    async start() {},
    async stop() {},
    getNetworkState() { return { online: true }; },
  });

  await assert.rejects(() => bridge.importConfiguration("config-text"), /capability unavailable: config-import/);
});
