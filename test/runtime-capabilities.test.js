import test from "node:test";
import assert from "node:assert/strict";
import {
  getKernelRuntimeCapabilities,
  supportsKernelRuntime,
} from "../src/kernel/runtime-capabilities.js";

test("Android native bindings are explicit only where upstream integration is established", () => {
  assert.deepEqual(getKernelRuntimeCapabilities("sing-box", "android"), {
    process: true,
    native: true,
  });
  assert.deepEqual(getKernelRuntimeCapabilities("xray", "android"), {
    process: true,
    native: true,
  });
  assert.deepEqual(getKernelRuntimeCapabilities("mihomo", "android"), {
    process: true,
    native: false,
  });
});

test("unsupported native backends are never advertised", () => {
  assert.equal(supportsKernelRuntime("mihomo", "ios", "native"), false);
  assert.equal(supportsKernelRuntime("sing-box", "windows", "native"), false);
  assert.equal(supportsKernelRuntime("xray", "linux", "native"), false);
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
