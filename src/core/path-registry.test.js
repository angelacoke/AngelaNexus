import test from "node:test";
import assert from "node:assert/strict";
import {
  PathRegistryStates,
  createPathRegistry,
} from "./path-registry.js";

test("path registry keeps immutable bounded path records", () => {
  const registry = createPathRegistry({ maxEntries: 2 });

  assert.equal(registry.register({
    id: "direct-1",
    type: "direct",
    verified: true,
    securityHealthy: true,
  }).ok, true);

  assert.equal(registry.register({
    id: "relay-1",
    type: "relay",
    verified: true,
    securityHealthy: true,
  }).ok, true);

  assert.equal(registry.register({
    id: "tun-1",
    type: "kernel-tunnel",
    verified: true,
    securityHealthy: true,
  }).ok, true);

  assert.equal(registry.get("direct-1"), null);
  assert.equal(registry.snapshot().size, 2);
  assert.equal(Object.isFrozen(registry.get("tun-1")), true);
});

test("path registry filters by safety and lifecycle state", () => {
  const registry = createPathRegistry();

  registry.register({ id: "safe", type: "direct", verified: true, securityHealthy: true });
  registry.register({ id: "unsafe", type: "direct", verified: true, securityHealthy: false });
  registry.register({ id: "disabled", type: "relay", verified: true, securityHealthy: true, state: PathRegistryStates.DISABLED });

  assert.equal(registry.list({ verified: true, securityHealthy: true }).length, 2);
  assert.equal(registry.list({ state: PathRegistryStates.DISABLED }).length, 1);
});

test("path registry updates and reports removal correctly", () => {
  const registry = createPathRegistry();
  registry.register({ id: "p1", type: "direct", verified: true });

  assert.equal(registry.update("p1", { state: PathRegistryStates.QUARANTINED }).ok, true);
  assert.equal(registry.get("p1").state, PathRegistryStates.QUARANTINED);
  assert.equal(registry.remove("p1").ok, true);
  assert.equal(registry.remove("p1").ok, false);
});
