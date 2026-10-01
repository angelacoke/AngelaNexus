import test from "node:test";
import assert from "node:assert/strict";
import { createDriverSelection, selectDriver, DriverSelectionStatus } from "../src/core/driver-scheduler.js";

test("selects the preferred compatible driver without polling or round-robin behavior", () => {
  const plan = { kind: "runtime-plan", protocol: { id: "vless" }, transport: { id: "tcp" } };
  const drivers = [
    { id: "mihomo", capabilities: ["stream-execution", "vless", "tcp"], state: "ready", canExecute: () => true },
    { id: "sing-box", capabilities: ["stream-execution", "vless", "tcp"], state: "ready", match: () => ({ preference: "preferred", reason: "native transport match" }), canExecute: () => true },
    { id: "xray", capabilities: ["stream-execution", "vless"], state: "ready", canExecute: () => true }
  ];

  const result = createDriverSelection({
    plan,
    drivers,
    requiredCapabilities: ["stream-execution", "vless", "tcp"]
  });

  assert.equal(result.status, DriverSelectionStatus.SELECTED);
  assert.equal(result.selected.id, "sing-box");
  assert.deepEqual(result.rejected.find(item => item.driver === "xray").missingCapabilities, ["tcp"]);
  assert.equal(selectDriver({ plan, drivers, requiredCapabilities: ["stream-execution", "vless", "tcp"] }), "sing-box");
});

test("fixed driver policy forbids silent fallback", () => {
  const result = createDriverSelection({
    plan: { kind: "runtime-plan" },
    drivers: [
      { id: "mihomo", capabilities: [], state: "failed", canExecute: () => false },
      { id: "xray", capabilities: ["required"], state: "ready", canExecute: () => true }
    ],
    requiredCapabilities: ["required"],
    fixedDriver: "mihomo",
    allowFailover: true
  });

  assert.equal(result.status, DriverSelectionStatus.REJECTED);
  assert.equal(result.selected, null);
  assert.equal(result.fallback.allowed, false);
  assert.match(result.explanation, /fixed driver/i);
});

test("allowed-driver policy is enforced before capability matching", () => {
  const result = createDriverSelection({
    plan: { kind: "runtime-plan" },
    drivers: [
      { id: "mihomo", capabilities: ["required"], state: "ready", canExecute: () => true },
      { id: "xray", capabilities: ["required"], state: "ready", canExecute: () => true }
    ],
    requiredCapabilities: ["required"],
    allowedDrivers: ["xray"]
  });

  assert.equal(result.selected.id, "xray");
  assert.equal(result.rejected[0].status, "user-disallowed");
});

test("failover candidates are explicit and never include the selected driver", () => {
  const result = createDriverSelection({
    plan: { kind: "runtime-plan" },
    drivers: [
      { id: "a", capabilities: ["required"], state: "ready", canExecute: () => true },
      { id: "b", capabilities: ["required"], state: "idle", canExecute: () => true }
    ],
    requiredCapabilities: ["required"],
    allowFailover: true
  });

  assert.equal(result.fallback.allowed, true);
  assert.equal(result.fallback.candidates.includes(result.selected.id), false);
});
