import test from "node:test";
import assert from "node:assert/strict";
import { PlatformCapabilities, PlatformId } from "./contract.js";
import {
  createPlatformPathProbeBinding,
  inspectPlatformPathProbeCapability,
} from "./platform-path-probe-bindings.js";

function platform(platformId, capabilities = []) {
  return {
    platform: platformId,
    capabilities,
    start() {},
    stop() {},
    getNetworkState() { return {}; },
    ...(capabilities.includes(PlatformCapabilities.PATH_PROBE)
      ? { probePath() { return "success"; } }
      : {}),
  };
}

test("binds Android non-root and root modes without inventing capability", async () => {
  const nonRoot = createPlatformPathProbeBinding(platform(PlatformId.ANDROID, [PlatformCapabilities.PATH_PROBE]), { mode: "non-root" });
  const root = createPlatformPathProbeBinding(platform(PlatformId.ANDROID, [PlatformCapabilities.PATH_PROBE]), { mode: "root" });
  assert.equal(nonRoot.mode, "non-root");
  assert.equal(root.mode, "root");
  assert.equal(nonRoot.supported, true);
  assert.equal((await root.adapter.executor.execute({ pathId: "p1" })).result, "success");
});

test("supports all declared platform profiles", () => {
  for (const id of Object.values(PlatformId)) {
    const binding = createPlatformPathProbeBinding(platform(id));
    assert.equal(binding.supported, false);
    assert.equal(binding.platform, id);
  }
});

test("capability inspection reports only native declarations", () => {
  const info = inspectPlatformPathProbeCapability(platform(PlatformId.WINDOWS));
  assert.equal(info.pathProbe, false);
  assert.deepEqual(info.declaredCapabilities, []);
});
