import test from "node:test";
import assert from "node:assert/strict";
import {
  getKernelRuntimeCapabilities,
  supportsKernelRuntime,
} from "../src/kernel/runtime-capabilities.js";

test("Android native bindings are advertised only where implemented", () => {
  assert.deepEqual(getKernelRuntimeCapabilities("mihomo", "android"), {
    process: true,
    native: true,
  });
  for (const kernel of ["sing-box", "xray"]) {
    assert.deepEqual(getKernelRuntimeCapabilities(kernel, "android"), {
      process: true,
      native: false,
    });
  }
});

test("unsupported native backends are never advertised", () => {
  for (const [kernel, platform] of [
    ["sing-box", "windows"],
    ["xray", "linux"],
    ["mihomo", "ios"],
  ]) {
    assert.equal(supportsKernelRuntime(kernel, platform, "native"), false);
  }
});

test("known process backends remain available", () => {
  for (const kernel of ["mihomo", "sing-box", "xray"]) {
    assert.equal(supportsKernelRuntime(kernel, "android", "process"), true);
    assert.equal(supportsKernelRuntime(kernel, "linux", "process"), true);
  }
});

test("unknown kernel or platform is rejected", () => {
  assert.throws(
    () => getKernelRuntimeCapabilities("unknown", "android"),
    /unsupported kernel runtime/,
  );
  assert.throws(
    () => getKernelRuntimeCapabilities("mihomo", "unknown"),
    /unsupported platform/,
  );
});
