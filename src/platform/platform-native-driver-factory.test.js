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

function androidRuntime() {
  return {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "policy-routing": true,
    "atomic-rollback": true,
    systemVpn: true,
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

test("factory binds Android transparent capability only when runtime evidence is complete", async () => {
  const factory = createPlatformNativeDriverFactory(
    implementation(PlatformId.ANDROID),
    { mode: "root", androidTransparentRuntime: androidRuntime() },
  );
  assert.equal(factory.supported, true);
  assert.equal(factory.mode, "root");
  assert.equal(factory.transparentBinding.supported, true);
  const result = await factory.transparentBinding.probePath({ pathId: "p-root" });
  assert.equal(result.result, "success");
  assert.equal(result.mode, "root");
  assert.equal(result.backend, "android-root");
});

test("factory fails closed when Android transparent runtime evidence is incomplete", () => {
  const factory = createPlatformNativeDriverFactory(
    implementation(PlatformId.ANDROID),
    { mode: "root", androidTransparentRuntime: { root: true, "root-authorized": true } },
  );
  assert.equal(factory.supported, false);
  assert.equal(factory.transparentBinding.supported, false);
  assert.equal(factory.reason, "root-capability-incomplete");
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
