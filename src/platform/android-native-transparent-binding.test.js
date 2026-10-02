import test from "node:test";
import assert from "node:assert/strict";
import { ANDROID_TRANSPARENT_MODES } from "./android-transparent-adapter.js";
import {
  createAndroidNativeTransparentBinding,
} from "./android-native-transparent-binding.js";

function rootRuntime() {
  return {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "process-identity": true,
    "policy-routing": true,
    "atomic-rollback": true,
    systemVpn: true,
  };
}

test("android native transparent binding preserves root capability selection", async () => {
  const binding = createAndroidNativeTransparentBinding({
    runtime: rootRuntime(),
    requestedMode: ANDROID_TRANSPARENT_MODES.ROOT,
    async probePath(task) {
      return { result: "success", mode: task.mode, backend: task.backend };
    },
  });

  assert.equal(binding.supported, true);
  assert.equal(binding.mode, "root");
  const result = await binding.probePath({ pathId: "p1" });
  assert.deepEqual(result, {
    result: "success",
    mode: "root",
    backend: "android-root",
  });
});

test("android native transparent binding fails closed when root is incomplete", async () => {
  const binding = createAndroidNativeTransparentBinding({
    runtime: { root: true, "root-authorized": true },
    requestedMode: ANDROID_TRANSPARENT_MODES.ROOT,
    async probePath() {
      throw new Error("must not be called");
    },
  });

  assert.equal(binding.supported, false);
  assert.equal(binding.mode, "unavailable");
  const result = await binding.probePath({ pathId: "p1" });
  assert.equal(result.result, "rejected");
});

test("android native transparent binding supports system mode without claiming root", async () => {
  const binding = createAndroidNativeTransparentBinding({
    runtime: { systemVpn: true },
    requestedMode: ANDROID_TRANSPARENT_MODES.SYSTEM,
    async probePath(task) {
      return { result: "degraded", mode: task.mode, backend: task.backend };
    },
  });

  assert.equal(binding.supported, true);
  assert.equal(binding.mode, "system");
  const result = await binding.probePath({ pathId: "p2" });
  assert.deepEqual(result, {
    result: "degraded",
    mode: "system",
    backend: "android-system-vpn",
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { ANDROID_TRANSPARENT_MODES } from "./android-transparent-adapter.js";
import { createAndroidNativeTransparentBinding } from "./android-native-transparent-binding.js";

function rootRuntime() {
  return {
    root: true,
    "root-authorized": true,
    tcp: true, udp: true, dns: true, ipv4: true, ipv6: true,
    "uid-identity": true, "process-identity": true,
    "policy-routing": true, "atomic-rollback": true, systemVpn: true,
  };
}

function probePath(task) {
  return { result: "success", mode: task.mode, backend: task.backend };
}

test("root transparent lifecycle requires verified native bridge before activation", async () => {
  const calls = [];
  const binding = createAndroidNativeTransparentBinding({
    runtime: rootRuntime(),
    requestedMode: ANDROID_TRANSPARENT_MODES.ROOT,
    probePath,
    prepareTransparent: async (ctx) => calls.push(["prepare", ctx.mode, ctx.backend]),
    applyTransparent: async (ctx) => calls.push(["apply", ctx.mode, ctx.backend]),
    verifyTransparent: async (ctx) => {
      calls.push(["verify", ctx.mode, ctx.backend]);
      return { ok: true };
    },
    rollbackTransparent: async (ctx) => calls.push(["rollback", ctx.reason]),
  });

  assert.equal(binding.lifecycleState(), "idle");
  assert.deepEqual(await binding.apply(), { ok: false, state: "idle", reason: "not-prepared" });
  assert.deepEqual(await binding.prepare(), { ok: true, state: "prepared", reason: "prepared" });
  assert.deepEqual(await binding.apply(), { ok: true, state: "active", reason: "applied" });
  assert.deepEqual(await binding.verify(), { ok: true, state: "active", reason: "verified" });
  assert.deepEqual(calls.map(x => x[0]), ["prepare", "apply", "verify"]);
});

test("verification failure rolls the native transparent state back", async () => {
  let rollbackReason = null;
  const binding = createAndroidNativeTransparentBinding({
    runtime: rootRuntime(),
    requestedMode: "root",
    probePath,
    prepareTransparent: async () => {},
    applyTransparent: async () => {},
    verifyTransparent: async () => false,
    rollbackTransparent: async (ctx) => { rollbackReason = ctx.reason; },
  });

  await binding.prepare();
  await binding.apply();
  assert.deepEqual(await binding.verify(), {
    ok: false, state: "rolled-back", reason: "verification-failed",
  });
  assert.equal(rollbackReason, "verification-failed");
});

test("apply failure attempts rollback and does not report active", async () => {
  let rolledBack = false;
  const binding = createAndroidNativeTransparentBinding({
    runtime: rootRuntime(),
    requestedMode: "root",
    probePath,
    prepareTransparent: async () => {},
    applyTransparent: async () => { throw new Error("native failure"); },
    rollbackTransparent: async () => { rolledBack = true; },
  });

  await binding.prepare();
  assert.deepEqual(await binding.apply(), {
    ok: false, state: "rolled-back", reason: "apply-failed",
  });
  assert.equal(rolledBack, true);
  assert.equal(binding.lifecycleState(), "rolled-back");
});

test("missing verification capability is fail-closed after activation", async () => {
  const binding = createAndroidNativeTransparentBinding({
    runtime: rootRuntime(),
    requestedMode: "root",
    probePath,
    prepareTransparent: async () => {},
    applyTransparent: async () => {},
  });

  await binding.prepare();
  await binding.apply();
  assert.deepEqual(await binding.verify(), {
    ok: false, state: "active", reason: "verification-unavailable",
  });
  assert.equal(binding.lifecycleState(), "active");
});

test("incomplete root capability cannot enter lifecycle", async () => {
  const binding = createAndroidNativeTransparentBinding({
    runtime: { root: true, "root-authorized": true },
    requestedMode: "root",
    probePath,
    prepareTransparent: async () => { throw new Error("must not run"); },
  });

  assert.deepEqual(await binding.prepare(), {
    ok: false, state: "idle", reason: "transparent-mode-unavailable",
  });
});
