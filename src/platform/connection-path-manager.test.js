import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectionPathTrust,
  ConnectionPathTypes,
  createConnectionPathManager,
} from "./connection-path-manager.js";
import { createPathRegistry } from "../core/path-registry.js";

test("connection path manager can evaluate registered paths", () => {
  const registry = createPathRegistry();
  registry.register({
    id: "direct",
    type: ConnectionPathTypes.DIRECT,
    verified: true,
    trust: ConnectionPathTrust.VERIFIED,
    health: "healthy",
    securityHealthy: true,
  });
  registry.register({
    id: "relay",
    type: ConnectionPathTypes.RELAY,
    verified: true,
    trust: ConnectionPathTrust.VERIFIED,
    health: "healthy",
    securityHealthy: true,
  });

  const manager = createConnectionPathManager({
    userPolicy: { preferredOrder: [ConnectionPathTypes.DIRECT, ConnectionPathTypes.RELAY] },
  });
  const result = manager.evaluateRegistry(registry);

  assert.equal(result.ok, true);
  assert.equal(result.selected.id, "direct");
  assert.equal(result.eligible.length, 2);
});

test("registry evaluation remains fail-closed for unsafe paths", () => {
  const registry = createPathRegistry();
  registry.register({
    id: "unsafe",
    type: ConnectionPathTypes.DIRECT,
    verified: true,
    trust: ConnectionPathTrust.VERIFIED,
    health: "healthy",
    securityHealthy: false,
  });

  const manager = createConnectionPathManager({ failClosed: true });
  const result = manager.evaluateRegistry(registry);

  assert.equal(result.ok, false);
  assert.equal(result.mode, "fail-closed");
  assert.equal(result.selected, null);
});
