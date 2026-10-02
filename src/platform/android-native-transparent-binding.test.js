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
