import test from "node:test";
import assert from "node:assert/strict";
import { assertUserChoice, canDecideAutomatically, createDecisionPrompt, getDecisionRegistry } from "../src/core/decision-registry.js";

test("decision registry separates intelligence from user decisions", () => {
  const registry = getDecisionRegistry();
  assert.ok(registry.autoActions.includes("detectFormat"));\n  assert.ok(registry.autoActions.includes("detectProtocol"));
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
  const prompt = createDecisionPrompt("nodeLimit", [
    { id: "unlimited", label: "No limit" },
    { id: "30", label: "30" },
    { id: "60", label: "60" },
    { id: "custom", label: "Custom" }
  ], { reason: "large subscription" });
  assert.equal(prompt.requiresUserChoice, true);
  assert.equal(prompt.options.length, 4);
  assert.equal(prompt.context.reason, "large subscription");
  assert.match(prompt.message, /present available options/);
});

test("required user decisions cannot be silently defaulted", () => {
  assert.throws(() => assertUserChoice("kernel", null), /explicit user choice required/);
  assert.equal(assertUserChoice("kernel", "sing-box"), "sing-box");
});
