import { PlatformCapabilities } from "./contract.js";
import { createPlatformBridge } from "./bridge.js";
import { DirectTransitActions, evaluateDirectTransit, createDirectTransitSessionState } from "../core/direct-transit.js";

function killSwitchRequirements(capabilities) {
  const required = [PlatformCapabilities.TUN, PlatformCapabilities.NETWORK_MONITOR, PlatformCapabilities.NETWORK_BLOCK];
  return required.filter((capability) => !capabilities.includes(capability));
}

function isSafeNetworkState(state) {
  return state && state.online === true && state.captivePortal !== true;
}

function directTransitRequirements(capabilities) {
  return [
    PlatformCapabilities.NATIVE_SOCKET_PATH,
    PlatformCapabilities.NATIVE_ROUTE,
    PlatformCapabilities.BYPASS_TUN,
    PlatformCapabilities.ROUTE_INTEGRITY,
  ].filter((capability) => !capabilities.includes(capability));
}

export function createPlatformRuntime(implementation, runtime) {
  if (!runtime || typeof runtime.start !== "function" || typeof runtime.stop !== "function") {
    throw new TypeError("kernel runtime requires start() and stop()");
  }
  const bridge = createPlatformBridge(implementation);
  let unsubscribe = null;
  let killSwitchEnabled = false;
  let networkGeneration = 0;
  let networkState = null;
  let directTransitState = createDirectTransitSessionState({ networkGeneration, validatedNetworkGeneration: networkGeneration });

  async function enableKillSwitch(options = {}) {
    const missing = killSwitchRequirements(bridge.capabilities);
    if (missing.length) throw new Error("kill switch requires platform capabilities: " + missing.join(", "));
    await bridge.enableNetworkBlock("kill-switch-start");
    killSwitchEnabled = true;
    await bridge.startTun(options);
  }

  async function disableKillSwitch(releaseReason = "kill-switch-release", transitionReason = "kill-switch-transition") {
    if (!killSwitchEnabled) return;
    await bridge.enableNetworkBlock(transitionReason);
    await bridge.stopTun();
    await bridge.disableNetworkBlock(releaseReason);
    killSwitchEnabled = false;
  }

  async function handleNetworkState(state) {
    networkGeneration += 1;
    networkState = state;
    directTransitState = createDirectTransitSessionState({
      networkGeneration,
      validatedNetworkGeneration: directTransitState.validatedNetworkGeneration
    });
    if (killSwitchEnabled) await bridge.enableNetworkBlock("kill-switch-network-change");
  }

  async function markNetworkPathRevalidated(generation = networkGeneration) {
    if (!Number.isInteger(generation) || generation !== networkGeneration) {
      return Object.freeze({ ok: false, reason: "network-generation-mismatch", networkGeneration });
    }
    if (!isSafeNetworkState(networkState || bridge.getNetworkState())) {
      return Object.freeze({ ok: false, reason: "network-state-not-safe", networkGeneration });
    }
    directTransitState = Object.freeze({
      ...directTransitState,
      validatedNetworkGeneration: networkGeneration,
      revalidationRequired: false
    });
    return Object.freeze({ ok: true, networkGeneration });
  }

  async function confirmNetworkRevalidated(generation = networkGeneration) {
    if (!killSwitchEnabled) return Object.freeze({ ok: false, reason: "kill-switch-not-active" });
    if (!Number.isInteger(generation) || generation !== networkGeneration) {
      return Object.freeze({ ok: false, reason: "network-generation-mismatch", networkGeneration });
    }
    if (directTransitState.revalidationRequired !== false ||
        directTransitState.validatedNetworkGeneration !== networkGeneration) {
      return Object.freeze({ ok: false, reason: "network-path-revalidation-required", networkGeneration });
    }
    await bridge.disableNetworkBlock("kill-switch-network-revalidated");
    return Object.freeze({ ok: true, networkGeneration });
  }

  async function validateDirectTransit(options = {}) {
    const missing = directTransitRequirements(bridge.capabilities);
    if (missing.length) {
      return Object.freeze({ action: DirectTransitActions.FAIL_CLOSED, reasons: Object.freeze(["missing-native-capability:" + missing.join(",")]) });
    }
    const nativeSocket = await bridge.openNativeSocketPath(options);
    const nativeRoute = await bridge.validateNativeRoute(options);
    const bypass = await bridge.setTunBypass(options);
    const routeIntegrity = await bridge.validateRouteIntegrity(options);
    const result = evaluateDirectTransit({
      capabilities: bridge.capabilities,
      tunEntered: options.tunEntered === true,
      proxyEntered: options.proxyEntered === true,
      route: { native: nativeRoute === true || nativeRoute?.native === true, consistent: routeIntegrity === true || routeIntegrity?.consistent === true },
      dnsPath: { consistent: options.dnsPathConsistent === true },
      networkGeneration,
      validatedNetworkGeneration: networkGeneration,
    });
    if (result.action === DirectTransitActions.NATIVE && (nativeSocket === false || bypass === false)) {
      return Object.freeze({ action: DirectTransitActions.FAIL_CLOSED, reasons: Object.freeze(["native-path-establishment-failed"]) });
    }
    if (result.action === DirectTransitActions.NATIVE) await markNetworkPathRevalidated(networkGeneration);
    return result;
  }

  return Object.freeze({
    platform: bridge.platform,
    capabilities: bridge.capabilities,
    async start(options = {}) {
      const security = options.security || {};
      if (security.killSwitch === true) await enableKillSwitch(options.tun || {});
      try {
        await runtime.start(options);
        await bridge.start();
        networkState = bridge.getNetworkState();
        if (security.killSwitch === true) {
          await bridge.disableNetworkBlock("kill-switch-network-initialized");
          unsubscribe = await bridge.subscribeNetworkState(handleNetworkState);
        } else if (directTransitRequirements(bridge.capabilities).length === 0) {
          unsubscribe = await bridge.subscribeNetworkState(handleNetworkState);
        }
        return networkState;
      } catch (error) {
        if (security.killSwitch === true) {
          try { await bridge.enableNetworkBlock("kill-switch-start-failed"); } catch {}
          try { await bridge.stopTun(); } catch {}
        }
        throw error;
      }
    },
    async stop() {
      if (unsubscribe) { await unsubscribe(); unsubscribe = null; }
      if (killSwitchEnabled) await disableKillSwitch("kill-switch-stop", "kill-switch-stop");
      await bridge.stop();
      await runtime.stop();
      return bridge.getNetworkState();
    },
    async reload(config) {
      if (typeof runtime.reload !== "function") throw new Error("kernel runtime does not support reload");
      return runtime.reload(config);
    },
    async status() {
      if (typeof runtime.status !== "function") throw new Error("kernel runtime does not support status");
      return runtime.status();
    },
    async logs(options = {}) {
      if (typeof runtime.logs !== "function") throw new Error("kernel runtime does not support logs");
      return runtime.logs(options);
    },
    async startTun(options = {}) { return bridge.startTun(options); },
    async stopTun() { return bridge.stopTun(); },
    async enableNetworkBlock(reason) { return bridge.enableNetworkBlock(reason); },
    async disableNetworkBlock(reason) { return bridge.disableNetworkBlock(reason); },
    async subscribeNetworkState(listener) { return bridge.subscribeNetworkState(listener); },
    async subscribeSessionInvalidation(listener) {
      if (typeof listener !== "function") throw new TypeError("session invalidation listener is required");
      return bridge.subscribeNetworkState(async () => listener("network-generation-changed"));
    },
    async validateDirectTransit(options = {}) { return validateDirectTransit(options); },
    async markNetworkPathRevalidated(generation) { return markNetworkPathRevalidated(generation); },
    async confirmNetworkRevalidated(generation) { return confirmNetworkRevalidated(generation); },
    getDirectTransitState() { return directTransitState; },
    getNetworkState() { return bridge.getNetworkState(); },
  });
}
