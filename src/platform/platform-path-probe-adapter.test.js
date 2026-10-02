import test from "node:test";
import assert from "node:assert/strict";
import {
  PlatformCapabilities,
  PlatformId,
} from "./contract.js";
import { createPlatformPathProbeAdapter } from "./platform-path-probe-adapter.js";

function basePlatform(overrides = {}) {
  return {
    platform: PlatformId.LINUX,
    capabilities: [PlatformCapabilities.PATH_PROBE],
    start() {},
    stop() {},
    getNetworkState() { return {}; },
    probePath() { return "success"; },
    ...overrides,
  };
}

test("binds path probe capability to platform implementation", async () => {
  const adapter = createPlatformPathProbeAdapter(basePlatform());
  assert.equal(adapter.supported, true);
  assert.equal(adapter.reason, "ready");
  const result = await adapter.executor.execute({ pathId: "p1" });
  assert.equal(result.result, "success");
});

test("unsupported platform capability is reported without executor", () => {
  const adapter = createPlatformPathProbeAdapter(
    basePlatform({ capabilities: [], probePath: undefined }),
  );
  assert.equal(adapter.supported, false);
  assert.equal(adapter.reason, "capability-unavailable");
  assert.equal(adapter.executor, null);
});

test("platform contract still rejects incomplete probe implementations", () => {
  assert.throws(
    () => createPlatformPathProbeAdapter(basePlatform({ probePath: undefined })),
    /requires method: probePath/,
  );
});
