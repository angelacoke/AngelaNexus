import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePathDriverIds,
  createNativePathDriverBinding,
  inspectNativePathDriver,
} from "./platform-native-path-drivers.js";

function implementation(platform, capabilities = ["path-probe"]) {
  return {
    platform,
    capabilities,
    start() {},
    stop() {},
    getNetworkState() {},
    ...(capabilities.includes("path-probe")
      ? { probePath() { return "success"; } }
      : {}),
  };
}

test("declared platform profiles expose explicit native boundaries", () => {
  assert.equal(inspectNativePathDriver("android").id, NativePathDriverIds.ANDROID);
  assert.equal(inspectNativePathDriver("linux").nativeBoundary, "socket-or-ebpf");
  assert.equal(inspectNativePathDriver("windows").nativeBoundary, "wfp");
  assert.equal(inspectNativePathDriver("macos").nativeBoundary, "network-extension");
  assert.equal(inspectNativePathDriver("ios").nativeBoundary, "network-extension");
});

test("Android root and non-root are explicit modes", () => {
  assert.equal(inspectNativePathDriver("android", { mode: "root" }).mode, "root");
  assert.equal(inspectNativePathDriver("android", { mode: "non-root" }).mode, "non-root");
});

test("binding is supported only when capability and native operation both exist", () => {
  const binding = createNativePathDriverBinding(implementation("linux"));
  assert.equal(binding.supported, true);
  assert.equal(binding.operation, "probePath");
});

test("missing capability never becomes a synthetic platform capability", () => {
  const binding = createNativePathDriverBinding(implementation("windows", []));
  assert.equal(binding.supported, false);
  assert.equal(binding.reason, "capability-unavailable");
});

test("missing native operation fails closed", () => {
  const value = implementation("android");
  delete value.probePath;
  const binding = createNativePathDriverBinding(value);
  assert.equal(binding.supported, false);
  assert.equal(binding.reason, "native-operation-unavailable");
});

test("unsupported platform is rejected", () => {
  assert.throws(() => inspectNativePathDriver("unknown"), /unsupported platform/);
});
