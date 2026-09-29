import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformRuntime } from "../src/platform/runtime.js";
import { PlatformCapabilities, PlatformId } from "../src/platform/contract.js";
import { createExecutionController, ExecutionStates } from "../src/core/execution-controller.js";
import { createSessionInvalidationSource } from "../src/core/session-invalidation.js";
import { createGfwRuntime, GfwSignals } from "../src/core/gfw-policy.js";
import { Kernels } from "../src/core/model.js";

function mockPlatform(failRuntimeStart = false) {
  const events = [];
  let networkListener = null;
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
      async subscribeNetworkState(listener) { events.push("monitor.on"); networkListener = listener; return async () => { networkListener = null; events.push("monitor.off"); }; },
      async openNativeSocketPath() { events.push("native.socket"); return true; },
      async validateNativeRoute() { events.push("native.route"); return true; },
      async setTunBypass() { events.push("native.bypass"); return true; },
      async validateRouteIntegrity() { events.push("native.integrity"); return true; },
      getNetworkState() { return { online: true, captivePortal: false }; },
      async emitNetworkChange(state = { online: true, captivePortal: false }) { if (networkListener) await networkListener(state); },
    },
    runtime: {
      async start() { events.push("runtime.start"); if (failRuntimeStart) throw new Error("runtime failed"); },
      async stop() { events.push("runtime.stop"); },
      async reload() { events.push("runtime.reload"); },
    },
    events,
  };
}

function executionRequest(id, networkGeneration = 0) {
  return { decision: { id, version: 1, action: "routing", choice: "proxy", requiresUserChoice: true, confirmed: false }, kernel: Kernels.SING_BOX, config: { kernel: Kernels.SING_BOX, nodes: [] }, userAuthorized: true, security: { preflightPassed: true, failClosed: true }, path: { validated: true, networkGeneration } };
}

function mockExecution(stoppedRef) { return { configPath: "/tmp/nexus-test/config.json", async start() {}, async stop() { stoppedRef.count += 1; }, async reload() {}, async status() { return { running: true }; }, async logs() {} }; }

test("kill switch remains armed after kernel startup failure", async () => {
  const mock = mockPlatform(true); const runtime = createPlatformRuntime(mock.implementation, mock.runtime);
  await assert.rejects(() => runtime.start({ security: { killSwitch: true } }), /runtime failed/); await runtime.stop();
  assert.ok(mock.events.includes("block.on:kill-switch-start-failed")); assert.ok(mock.events.includes("block.off:kill-switch-stop"));
});

test("kill switch releases only during an orderly stop", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start({ security: { killSwitch: true } }); await runtime.stop();
  assert.ok(mock.events.includes("block.on:kill-switch-start")); assert.ok(mock.events.includes("tun.start")); assert.ok(!mock.events.includes("block.off:kill-switch-network-restored")); assert.ok(mock.events.includes("block.off:kill-switch-stop"));
});

test("native direct transit is validated through platform capabilities", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start();
  const result = await runtime.validateDirectTransit({ dnsPathConsistent: true });
  assert.equal(result.action, "native"); assert.equal(runtime.getDirectTransitState().revalidationRequired, false);
  assert.ok(mock.events.includes("native.socket")); assert.ok(mock.events.includes("native.route")); assert.ok(mock.events.includes("native.bypass")); assert.ok(mock.events.includes("native.integrity")); await runtime.stop();
});

test("stale direct transit validation is rejected after network generation changes", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start();
  const first = await runtime.validateDirectTransit({ dnsPathConsistent: true }); assert.equal(first.action, "native");
  await mock.implementation.emitNetworkChange();
  const stale = await runtime.validateDirectTransit({ dnsPathConsistent: true });
  assert.equal(stale.action, "revalidate"); assert.match(stale.reasons[0], /network-generation-changed/); assert.equal(runtime.getDirectTransitState().revalidationRequired, true); await runtime.stop();
});

test("network change keeps the kill switch armed until explicit path revalidation", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start({ security: { killSwitch: true } }); await mock.implementation.emitNetworkChange();
  assert.equal(runtime.getDirectTransitState().revalidationRequired, true); assert.ok(mock.events.includes("block.on:kill-switch-network-change")); assert.ok(!mock.events.includes("block.off:kill-switch-network-revalidated"));
  const premature = await runtime.confirmNetworkRevalidated(1); assert.equal(premature.ok, false); assert.equal(premature.reason, "network-path-revalidation-required");
  const marked = await runtime.markNetworkPathRevalidated(1); assert.equal(marked.ok, true); const released = await runtime.confirmNetworkRevalidated(1); assert.equal(released.ok, true); assert.ok(mock.events.includes("block.off:kill-switch-network-revalidated")); await runtime.stop();
});

test("network change invalidates native direct transit validation", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start(); await runtime.validateDirectTransit({ dnsPathConsistent: true }); assert.equal(runtime.getDirectTransitState().revalidationRequired, false); await mock.implementation.emitNetworkChange(); assert.equal(runtime.getDirectTransitState().revalidationRequired, true); await runtime.stop();
});

test("kernel reload invalidates an active network path session", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start({ security: { killSwitch: true } }); const before = runtime.getDirectTransitState().networkGeneration; await runtime.reload({ version: 2 }); const state = runtime.getDirectTransitState();
  assert.equal(state.networkGeneration, before + 1); assert.equal(state.validatedNetworkGeneration, null); assert.equal(state.revalidationRequired, true); assert.ok(mock.events.includes("block.on:kill-switch-reload")); assert.ok(mock.events.includes("runtime.reload")); assert.ok(!mock.events.includes("block.off:kill-switch-network-revalidated")); await runtime.stop();
});

test("platform runtime exposes network changes as execution session invalidation", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start(); let reason = null; const unsubscribe = await runtime.subscribeSessionInvalidation(async value => { reason = value; }); await mock.implementation.emitNetworkChange(); assert.equal(reason, "network-generation-changed"); await unsubscribe(); await runtime.stop();
});

test("platform network changes fail closed a running execution session", async () => {
  const mock = mockPlatform(); const runtime = createPlatformRuntime(mock.implementation, mock.runtime); await runtime.start(); const stopped = { count: 0 }; const controller = createExecutionController({ executionFactory: async () => mockExecution(stopped), pathRevalidator: async path => ({ ...path, networkGeneration: 0 }), sessionInvalidationSource: runtime.subscribeSessionInvalidation.bind(runtime) }); await controller.prepare(executionRequest("platform-session-001")); await controller.start(); assert.equal(controller.state, ExecutionStates.RUNNING); await mock.implementation.emitNetworkChange(); await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped.count, 1); assert.equal(controller.state, ExecutionStates.FAILED); await runtime.stop();
});

test("platform and GFW invalidation sources compose into one fail-closed execution session", async () => {
  const mock = mockPlatform(); const platform = createPlatformRuntime(mock.implementation, mock.runtime); const gfw = createGfwRuntime(); await platform.start(); const stopped = { count: 0 }; const invalidationSource = createSessionInvalidationSource(platform.subscribeSessionInvalidation.bind(platform), gfw.subscribeInvalidation); const controller = createExecutionController({ executionFactory: async () => mockExecution(stopped), pathRevalidator: async path => ({ ...path, networkGeneration: 0 }), sessionInvalidationSource: invalidationSource }); await controller.prepare(executionRequest("composite-session-001")); await controller.start(); assert.equal(controller.state, ExecutionStates.RUNNING); gfw.observe({ signal: GfwSignals.TCP_RESET }, 100000); await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped.count, 1); assert.equal(controller.state, ExecutionStates.FAILED); assert.match(controller.snapshot().failure, /gfw-path-revalidation-required/); await controller.stop(); await platform.stop();
});

test("composed invalidation source is fully unsubscribed when execution stops", async () => {
  const subscriptions = []; const source = createSessionInvalidationSource(async listener => { subscriptions.push({ name: "first", listener, active: true }); return async () => { subscriptions[0].active = false; }; }, async listener => { subscriptions.push({ name: "second", listener, active: true }); return async () => { subscriptions[1].active = false; }; }); const stopped = { count: 0 }; const controller = createExecutionController({ executionFactory: async () => mockExecution(stopped), pathRevalidator: async path => path, sessionInvalidationSource: source }); await controller.prepare(executionRequest("composite-unsubscribe-001")); await controller.start(); await controller.stop(); assert.deepEqual(subscriptions.map(item => item.active), [false, false]);
});
