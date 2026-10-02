import test from "node:test";
import assert from "node:assert/strict";
import { PlatformId, PlatformCapabilities } from "./contract.js";
import {
  createAndroidTransparentRuntimeFactory,
} from "./android-transparent-runtime-factory.js";

function implementation() {
  return {
    platform: PlatformId.ANDROID,
    capabilities: [PlatformCapabilities.PATH_PROBE],
    start() {},
    stop() {},
    getNetworkState() {},
    async probePath(task) {
      return {
        result: "success",
        mode: task.mode,
        backend: task.backend,
      };
    },
  };
}

function completeRootRuntime() {
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

test("Android transparent runtime factory binds verified root mode", async () => {
  const factory = createAndroidTransparentRuntimeFactory(implementation(), {
    mode: "root",
    runtime: completeRootRuntime(),
  });

  assert.equal(factory.supported, true);
  assert.equal(factory.mode, "root");

  const result = await factory.binding.probePath({ pathId: "p-root" });
  assert.deepEqual(result, {
    result: "success",
    mode: "root",
    backend: "android-root",
  });
});

test("Android transparent runtime factory fails closed for incomplete root evidence", () => {
  const factory = createAndroidTransparentRuntimeFactory(implementation(), {
    mode: "root",
    runtime: { root: true, "root-authorized": true },
  });

  assert.equal(factory.supported, false);
  assert.equal(factory.mode, "unavailable");
  assert.equal(factory.reason, "root-capability-incomplete");
});

test("Android transparent runtime factory rejects non-Android implementations", () => {
  assert.throws(
    () => createAndroidTransparentRuntimeFactory({
      ...implementation(),
      platform: PlatformId.LINUX,
    }),
    /requires android platform/,
  );
});

test("Android transparent runtime factory preserves system mode without root", async () => {
  const factory = createAndroidTransparentRuntimeFactory(implementation(), {
    mode: "system",
    runtime: { systemVpn: true },
  });

  assert.equal(factory.supported, true);
  assert.equal(factory.mode, "system");

  const result = await factory.binding.probePath({ pathId: "p-system" });
  assert.equal(result.result, "success");
  assert.equal(result.backend, "android-system-vpn");
});
