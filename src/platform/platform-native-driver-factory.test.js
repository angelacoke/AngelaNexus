import test from "node:test";
import assert from "node:assert/strict";
import {
  PlatformCapabilities,
  PlatformId,
} from "./contract.js";
import {
  createPlatformNativeDriverFactory,
  inspectPlatformNativeDriver,
} from "./platform-native-driver-factory.js";

function implementation(platform) {
  return {
    platform,
    capabilities: [PlatformCapabilities.PATH_PROBE],
    start() {},
    stop() {},
    getNetworkState() {},
    async probePath() {
      return { result: "success" };
    },
  };
}

test("factory exposes explicit platform native boundaries", () => {
  assert.equal(inspectPlatformNativeDriver(PlatformId.ANDROID, { mode: "root" }).mode, "root");
  assert.equal(inspectPlatformNativeDriver(PlatformId.LINUX).nativeBoundary, "socket-or-ebpf");
  assert.equal(inspectPlatformNativeDriver(PlatformId.WINDOWS).nativeBoundary, "wfp");
  assert.equal(inspectPlatformNativeDriver(PlatformId.MACOS).nativeBoundary, "network-extension");
  assert.equal(inspectPlatformNativeDriver(PlatformId.IOS).nativeBoundary, "network-extension");
});

test("factory binds a declared native probe implementation", () => {
  const factory = createPlatformNativeDriverFactory(implementation(PlatformId.ANDROID), { mode: "non-root" });
  assert.equal(factory.supported, true);
  assert.equal(factory.mode, "non-root");
  assert.equal(factory.adapter.supported, true);
});

test("factory remains fail-closed when native capability is absent", () => {
  const value = implementation(PlatformId.LINUX);
  value.capabilities = [];
  const factory = createPlatformNativeDriverFactory(value);
  assert.equal(factory.supported, false);
  assert.equal(factory.reason, "capability-unavailable");
});

test("factory never invents unsupported platform", () => {
  assert.throws(() => inspectPlatformNativeDriver("unknown"), /unsupported platform/);
});
