import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionPathTrust,
  ConnectionPathTypes,
  createConnectionPathManager,
} from "../src/platform/connection-path-manager.js";

function candidate(overrides = {}) {
  return {
    id: "path-1",
    type: ConnectionPathTypes.KERNEL_TUNNEL,
    trust: ConnectionPathTrust.VERIFIED,
    verified: true,
    health: "healthy",
    securityHealthy: true,
    ...overrides,
  };
}

test("selects only a verified healthy path allowed by the user policy", () => {
  const manager = createConnectionPathManager({
    userPolicy: {
      allowedTypes: [ConnectionPathTypes.RELAY, ConnectionPathTypes.KERNEL_TUNNEL],
      preferredOrder: [ConnectionPathTypes.RELAY, ConnectionPathTypes.KERNEL_TUNNEL],
    },
  });
  const result = manager.evaluate([
    candidate({ id: "kernel", type: ConnectionPathTypes.KERNEL_TUNNEL }),
    candidate({ id: "relay", type: ConnectionPathTypes.RELAY }),
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.selected.id, "relay");
});

test("rejects unverified paths even when they are otherwise healthy", () => {
  const manager = createConnectionPathManager();
  const result = manager.evaluate([
    candidate({ trust: ConnectionPathTrust.UNVERIFIED, verified: false }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-verified-path-fail-closed");
  assert.equal(result.selected, null);
});

test("fails closed when no verified path remains", () => {
  const manager = createConnectionPathManager({ failClosed: true });
  const result = manager.evaluate([
    candidate({ securityHealthy: false }),
    candidate({ id: "bad-health", health: "degraded" }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.mode, "fail-closed");
});

test("does not invent a fallback path when the user allowed types exclude it", () => {
  const manager = createConnectionPathManager({
    userPolicy: { allowedTypes: [ConnectionPathTypes.RELAY] },
  });
  const result = manager.evaluate([
    candidate({ type: ConnectionPathTypes.KERNEL_TUNNEL }),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-verified-path-fail-closed");
});

test("explicit non-fail-closed mode is observable rather than silently direct", () => {
  const manager = createConnectionPathManager({ failClosed: false });
  const result = manager.evaluate([]);
  assert.equal(result.ok, false);
  assert.equal(result.mode, "no-verified-path");
  assert.equal(result.selected, null);
});
