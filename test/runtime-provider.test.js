import test from "node:test";
import assert from "node:assert/strict";
import {
  createKernelRuntimeProvider,
  KERNEL_RUNTIME_MODES,
} from "../src/kernel/runtime-provider.js";

test("runtime provider selects the process backend explicitly", () => {
  const calls = [];
  const provider = createKernelRuntimeProvider({
    kernel: "mihomo",
    processFactory(kernel, options) {
      calls.push([kernel, options]);
      return { kind: "process" };
    },
  });

  assert.deepEqual(KERNEL_RUNTIME_MODES, new Set(["process", "native"]));
  assert.equal(provider.mode, "process");
  assert.deepEqual(provider.create({ binary: "mihomo" }), { kind: "process" });
  assert.deepEqual(calls, [["mihomo", { binary: "mihomo" }]]);
});

test("runtime provider selects the native backend explicitly", () => {
  const calls = [];
  const provider = createKernelRuntimeProvider({
    kernel: "sing-box",
    mode: "native",
    nativeFactory(kernel, options) {
      calls.push([kernel, options]);
      return { kind: "native" };
    },
  });

  assert.equal(provider.mode, "native");
  assert.deepEqual(provider.create({ transport: "android" }), { kind: "native" });
  assert.deepEqual(calls, [["sing-box", { transport: "android" }]]);
});

test("runtime provider does not silently fall back between backends", () => {
  assert.throws(
    () => createKernelRuntimeProvider({
      kernel: "xray",
      mode: "native",
      processFactory() {
        return {};
      },
    }),
    /native runtime factory is required/,
  );

  assert.throws(
    () => createKernelRuntimeProvider({
      kernel: "mihomo",
      mode: "process",
      nativeFactory() {
        return {};
      },
    }),
    /process runtime factory is required/,
  );
});

test("runtime provider rejects unknown modes", () => {
  assert.throws(
    () => createKernelRuntimeProvider({
      kernel: "mihomo",
      mode: "embedded",
      processFactory() {
        return {};
      },
    }),
    /unsupported kernel runtime mode/,
  );
});
