import test from "node:test";
import assert from "node:assert/strict";
import { DevicePolicyEngine } from "./device-policy-engine.js";

const clock = () => new Date("2026-10-02T13:00:00.000Z");

test("user app policy takes precedence over lower-priority defaults", () => {
  const engine = new DevicePolicyEngine({
    clock,
    policies: [{ id: "user-app", matchType: "app", value: "com.example.app", action: "proxy", priority: 100 }],
    systemDefaults: [{ id: "system-default", matchType: "default", action: "direct", priority: 0 }],
  });
  const decision = engine.evaluate({ app: "com.example.app" });
  assert.equal(decision.action, "proxy");
  assert.equal(decision.source, "user");
});

test("more specific matching policy wins at equal priority", () => {
  const engine = new DevicePolicyEngine({
    clock,
    policies: [
      { id: "device", matchType: "device", value: "phone-1", action: "direct", priority: 10 },
      { id: "app", matchType: "app", value: "com.example.app", action: "proxy", priority: 10 },
    ],
  });
  const decision = engine.evaluate({ device: "phone-1", app: "com.example.app" });
  assert.equal(decision.action, "proxy");
  assert.equal(decision.selectedPolicyId, "app");
});

test("same-rank conflicting rules fail closed", () => {
  const engine = new DevicePolicyEngine({
    clock,
    policies: [
      { id: "a", matchType: "app", value: "com.example.app", action: "proxy", priority: 20 },
      { id: "b", matchType: "app", value: "com.example.app", action: "direct", priority: 20 },
    ],
  });
  const decision = engine.evaluate({ app: "com.example.app" });
  assert.equal(decision.action, "block");
  assert.equal(decision.conflict, true);
  assert.equal(decision.source, "conflict-fail-closed");
});

test("unmatched policy returns explicit direct decision", () => {
  const engine = new DevicePolicyEngine({ clock, policies: [] });
  const decision = engine.evaluate({ app: "com.other.app" });
  assert.equal(decision.action, "direct");
  assert.equal(decision.selectedPolicyId, null);
});
