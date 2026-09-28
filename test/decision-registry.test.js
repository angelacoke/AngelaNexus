import test from "node:test";
import assert from "node:assert/strict";
import { assertUserChoice, canDecideAutomatically, createDecisionPrompt, createDecisionRecord, getDecisionRegistry } from "../src/core/decision-registry.js";

test("decision registry separates intelligence from user decisions", () => {
  const registry = getDecisionRegistry();
  assert.ok(registry.autoActions.includes("detectFormat"));
  assert.ok(registry.autoActions.includes("detectProtocol"));
  assert.ok(registry.autoActions.includes("validateConfig"));
  assert.ok(registry.userDecisions.includes("nodeLimit"));
  assert.ok(registry.userDecisions.includes("routing"));
  assert.ok(registry.userDecisions.includes("chain"));
});

test("Nexus may analyze automatically but not silently choose user policy", () => {
  assert.equal(canDecideAutomatically("detectFormat"), true);
  assert.equal(canDecideAutomatically("validateConfig"), true);
  assert.equal(canDecideAutomatically("nodeLimit"), false);
  assert.equal(canDecideAutomatically("routing"), false);
  assert.equal(canDecideAutomatically("kernelUpgrade"), false);
});

test("decision prompts expose choices instead of hiding them", () => {
  const prompt = createDecisionPrompt("nodeLimit", [{ id: "30", label: "30" }], { reason: "large subscription" });
  assert.equal(prompt.requiresUserChoice, true);
  assert.equal(prompt.options.length, 1);
  assert.equal(prompt.context.reason, "large subscription");
  assert.match(prompt.message, /present available options/);
});

test("required user decisions cannot be silently defaulted", () => {
  assert.throws(() => assertUserChoice("kernel", null), /explicit user choice required/);
  assert.equal(assertUserChoice("kernel", "sing-box"), "sing-box");
});

test("decision records are the authoritative bridge into execution", () => {
  const record = createDecisionRecord({ id: "decision-routing-001", action: "routing", choice: "proxy" });
  assert.equal(record.id, "decision-routing-001");
  assert.equal(record.action, "routing");
  assert.equal(record.choice, "proxy");
  assert.equal(record.requiresUserChoice, true);
});

test("destructive decisions require explicit confirmation", () => {
  assert.throws(() => createDecisionRecord({ id: "upgrade-001", action: "kernelUpgrade", choice: "stable" }), /explicit confirmation/);
  const record = createDecisionRecord({ id: "upgrade-002", action: "kernelUpgrade", choice: "stable", confirmed: true });
  assert.equal(record.confirmed, true);
});
