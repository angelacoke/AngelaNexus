import test from "node:test";
import assert from "node:assert/strict";
import { createPathProbeExecutor, PathProbeResults } from "./path-probe-executor.js";

test("probe executor rejects without explicit path-probe capability", async () => {
  const executor = createPathProbeExecutor({
    platform: "android",
    capabilities: [],
    probe: async () => PathProbeResults.SUCCESS,
  });
  const result = await executor.execute({ pathId: "direct", attempts: 1 });
  assert.equal(result.result, PathProbeResults.REJECTED);
  assert.equal(result.reason, "capability-unavailable");
});

test("probe executor enforces user, security and verification gates", async () => {
  let calls = 0;
  const executor = createPathProbeExecutor({
    platform: "linux",
    capabilities: ["path-probe"],
    probe: async () => {
      calls += 1;
      return PathProbeResults.SUCCESS;
    },
  });

  const denied = await executor.execute(
    { pathId: "direct", attempts: 1 },
    { userAllowed: false },
  );
  assert.equal(denied.result, PathProbeResults.REJECTED);
  assert.equal(calls, 0);

  const result = await executor.execute(
    { pathId: "direct", attempts: 1 },
    { userAllowed: true, securityHealthy: true, verified: true },
  );
  assert.equal(result.result, PathProbeResults.SUCCESS);
  assert.equal(calls, 1);
});

test("probe executor normalizes unknown probe results to failure", async () => {
  const executor = createPathProbeExecutor({
    platform: "windows",
    capabilities: ["path-probe"],
    probe: async () => "unknown",
  });
  const result = await executor.execute(
    { pathId: "relay", attempts: 1 },
    { userAllowed: true, securityHealthy: true, verified: true },
  );
  assert.equal(result.result, PathProbeResults.FAILURE);
});

test("probe executor contains probe exceptions", async () => {
  const executor = createPathProbeExecutor({
    platform: "macos",
    capabilities: ["path-probe"],
    probe: async () => {
      throw new Error("network failure");
    },
  });
  const result = await executor.execute(
    { pathId: "relay", attempts: 1 },
    { userAllowed: true, securityHealthy: true, verified: true },
  );
  assert.equal(result.result, PathProbeResults.FAILURE);
  assert.equal(result.reason, "probe-error");
});
