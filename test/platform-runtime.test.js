import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformRuntime } from "../src/platform/runtime.js";
import { PlatformCapabilities, PlatformId } from "../src/platform/contract.js";

function mockPlatform(failRuntimeStart = false) {
  const events = [];
  return {
    implementation: {
      platform: PlatformId.ANDROID,
      capabilities: [PlatformCapabilities.TUN, PlatformCapabilities.NETWORK_MONITOR, PlatformCapabilities.NETWORK_BLOCK, PlatformCapabilities.NATIVE_SOCKET_PATH, PlatformCapabilities.NATIVE_ROUTE, PlatformCapabilities.BYPASS_TUN, PlatformCapabilities.ROUTE_INTEGRITY],
      async start() { events.push("platform.start"); },
      async stop() { events.push("platform.stop"); },
      async startTun() { events.push("tun.start"); },
      async stopTun() { events.push("tun.stop"); },
      async enableNetworkBlock(reason) { events.push("block.on:" + reason); },
      async disableNetworkBlock(reason) { events.push("block.off:" + reason); },
      async subscribeNetworkState() { events.push("monitor.on"); return async () => events.push("monitor.off"); },\n      async openNativeSocketPath() { events.push("native.socket"); return true; },\n      async validateNativeRoute() { events.push("native.route"); return true; },\n      async setTunBypass() { events.push("native.bypass"); return true; },\n      async validateRouteIntegrity() { events.push("native.integrity"); return true; },
      getNetworkState() { return { online: true, captivePortal: false }; }
    },
    runtime: {
      async start() { events.push("runtime.start"); if (failRuntimeStart) throw new Error("runtime failed"); },
      async stop() { events.push("runtime.stop"); }
    },
    events
  };
}

test("kill switch remains armed after kernel startup failure", async () => {
  const mock = mockPlatform(true);
  const runtime = createPlatformRuntime(mock.implementation, mock.runtime);
  await assert.rejects(() => runtime.start({ security: { killSwitch: true } }), /runtime failed/);
  await runtime.stop();
  assert.ok(mock.events.includes("block.on:kill-switch-start-failed"));
  assert.ok(mock.events.includes("block.off:kill-switch-stop"));
});

test("kill switch releases only during an orderly stop", async () => {
  const mock = mockPlatform();
  const runtime = createPlatformRuntime(mock.implementation, mock.runtime);
  await runtime.start({ security: { killSwitch: true } });
  await runtime.stop();
  assert.ok(mock.events.includes("block.on:kill-switch-start"));
  assert.ok(mock.events.includes("tun.start"));
  assert.ok(mock.events.includes("block.off:kill-switch-network-restored"));
  assert.ok(mock.events.includes("block.off:kill-switch-stop"));
});


test("native direct transit is validated through platform capabilities", async () => {
  const mock = mockPlatform();
  const runtime = createPlatformRuntime(mock.implementation, mock.runtime);
  await runtime.start();
  const result = await runtime.validateDirectTransit({ dnsPathConsistent: true });
  assert.equal(result.action, "native");
  assert.equal(runtime.getDirectTransitState().revalidationRequired, false);
  assert.ok(mock.events.includes("native.socket"));
  assert.ok(mock.events.includes("native.route"));
  assert.ok(mock.events.includes("native.bypass"));
  assert.ok(mock.events.includes("native.integrity"));
  await runtime.stop();
});

test("network change invalidates native direct transit validation", async () => {
  const mock = mockPlatform();
  const runtime = createPlatformRuntime(mock.implementation, mock.runtime);
  await runtime.start({ security: { killSwitch: true } });
  await runtime.validateDirectTransit({ dnsPathConsistent: true });
  await mock.implementation.subscribeNetworkState(() => {});
  const result = await runtime.validateDirectTransit({ dnsPathConsistent: true });
  assert.equal(result.action, "native");
  await runtime.stop();
});
