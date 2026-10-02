import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveKernelRuntimeMode,
  requireKernelRuntimeMode,
} from "./runtime-boundary.js";

test("auto mode selects the implemented Android native Mihomo runtime", () => {
  const result = resolveKernelRuntimeMode("mihomo", "android");
  assert.equal(result.ok, true);
  assert.equal(result.selectedMode, "native");
});

test("auto mode selects process runtime for Android sing-box and Xray", () => {
  for (const kernel of ["sing-box", "xray"]) {
    const result = resolveKernelRuntimeMode(kernel, "android");
    assert.equal(result.ok, true);
    assert.equal(result.selectedMode, "process");
  }
});

test("explicit native requests fail closed when native runtime is absent", () => {
  for (const kernel of ["sing-box", "xray"]) {
    const result = resolveKernelRuntimeMode(kernel, "android", {
      requestedMode: "native",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /native runtime/);
    assert.throws(
      () => requireKernelRuntimeMode(kernel, "android", { requestedMode: "native" }),
      /runtime mode rejected/,
    );
  }
});

test("required native mode never silently falls back to process", () => {
  const result = resolveKernelRuntimeMode("sing-box", "android", {
    requireNative: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.selectedMode, null);
});
