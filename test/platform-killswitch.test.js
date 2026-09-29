import test from "node:test";
import assert from "node:assert/strict";
import { PlatformCapabilities, PlatformId } from "../src/platform/contract.js";
import { createPlatformRuntime } from "../src/platform/runtime.js";

function fakePlatform(overrides = {}) {
  const events = [];
  let listener = null;
  const platform = {
    platform: PlatformId.ANDROID,
    capabilities: [
      PlatformCapabilities.TUN,
      PlatformCapabilities.NETWORK_MONITOR,
      PlatformCapabilities.NETWORK_BLOCK,
    ],
    online: true,
    async start() { events.push("platform:start"); },
    async stop() { events.push("platform:stop"); },
    getNetworkState() { return { online: this.online, captivePortal: false }; },
    async startTun() { events.push("tun:start"); },
    async stopTun() { events.push("tun:stop"); },
    async subscribeNetworkState(fn) { listener = fn; events.push("network:subscribe"); return () => { listener = null; events.push("network:unsubscribe"); }; },
    async enableNetworkBlock(reason) { events.push("block:on:" + reason); },
    async disableNetworkBlock(reason) { events.push("block:off:" + reason); },
    ...overrides,
  };
  return {
    platform,
    events,
    emit(state) { platform.online = state.online; return listener && listener(state); },
  };
}

function fakeKernel() {
  return {
    async start() {},
    async stop() {},
  };
}

test("kill switch requires TUN, network monitor and network block capabilities", async () => {
  const fake = fakePlatform({ capabilities: [PlatformCapabilities.TUN, PlatformCapabilities.NETWORK_MONITOR] });
  const runtime = createPlatformRuntime(fake.platform, fakeKernel());
  await assert.rejects(() => runtime.start({ security: { killSwitch: true } }), /network-block/);
  assert.deepEqual(fake.events, []);
});

test("kill switch remains armed until initial path validation and explicit release", async () => {
  const fake = fakePlatform();
  const runtime = createPlatformRuntime(fake.platform, fakeKernel());

  await runtime.start({ security: { killSwitch: true } });
  assert.deepEqual(fake.events.slice(0, 4), [
    "block:on:kill-switch-start",
    "tun:start",
    "platform:start",
    "network:subscribe",
  ]);
  assert.ok(!fake.events.includes("block:off:kill-switch-network-initialized"));
  const premature = await runtime.confirmNetworkRevalidated(0);
  assert.equal(premature.ok, false);
  assert.equal(premature.reason, "network-path-revalidation-required");

  await runtime.stop();
  assert.ok(fake.events.includes("block:on:kill-switch-stop"));
  assert.ok(fake.events.includes("tun:stop"));
  assert.ok(fake.events.includes("block:off:kill-switch-stop"));
  assert.equal(fake.events.at(-1), "platform:stop");
});

test("kill switch releases only after a safe network state is explicitly revalidated", async () => {
  const fake = fakePlatform();
  const runtime = createPlatformRuntime(fake.platform, fakeKernel());

  await runtime.start({ security: { killSwitch: true } });
  await fake.emit({ online: false, captivePortal: false });
  assert.equal(fake.events.at(-1), "block:on:kill-switch-network-change");

  await fake.emit({ online: true, captivePortal: false });
  assert.equal(fake.events.at(-1), "block:on:kill-switch-network-change");

  const marked = await runtime.markNetworkPathRevalidated(2);
  assert.equal(marked.ok, true);
  const released = await runtime.confirmNetworkRevalidated(2);
  assert.equal(released.ok, true);
  assert.equal(fake.events.at(-1), "block:off:kill-switch-network-revalidated");

  await runtime.stop();
});

test("captive portal is treated as unsafe while kill switch is active", async () => {
  const fake = fakePlatform();
  const runtime = createPlatformRuntime(fake.platform, fakeKernel());
  await runtime.start({ security: { killSwitch: true } });
  await fake.emit({ online: true, captivePortal: true });
  assert.equal(fake.events.at(-1), "block:on:kill-switch-network-change");
});
