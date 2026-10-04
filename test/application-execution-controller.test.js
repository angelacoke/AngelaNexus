import test from "node:test";
import assert from "node:assert/strict";
import { createApplicationExecutionController, ApplicationExecutionStates } from "../src/core/application-execution-controller.js";

function input(overrides = {}) {
  return {
    identity: { platform: "android", packageName: "com.example.app", processName: "com.example.app" },
    policy: { matched: true, action: "proxy", ruleId: "app-rule-1" },
    drivers: [{
      id: "android-vpn",
      capabilities: ["application-scope"],
      health: { state: "ready" },
      canExecute: () => true,
      execute: async () => ({ status: "active", execution: { stop: async () => {} } })
    }],
    requiredCapabilities: ["application-scope"],
    userAuthorized: true,
    decisionId: "decision-1",
    kernel: "sing-box",
    ...overrides
  };
}

test("records planned, active and explicitly verified execution evidence", async () => {
  const controller = createApplicationExecutionController({
    verifier: async () => ({ status: "verified", reason: "native egress probe matched expected route" })
  });
  await controller.planExecution(input());
  assert.equal(controller.state, ApplicationExecutionStates.PLANNED);
  await controller.execute();
  assert.equal(controller.state, ApplicationExecutionStates.VERIFIED);
  assert.equal(controller.evidence().verified, true);
  assert.equal(controller.evidence().verificationStatus, "verified");
  assert.ok(controller.events().some(event => event.type === "application-execution"));
});

test("never claims verified when the driver provides no verification", async () => {
  const controller = createApplicationExecutionController();
  await controller.planExecution(input());
  await controller.execute();
  assert.equal(controller.state, ApplicationExecutionStates.UNVERIFIED);
  assert.equal(controller.evidence().verified, false);
  assert.equal(controller.evidence().verificationStatus, "unverified");
});

test("fails closed when no driver can execute the application plan", async () => {
  const controller = createApplicationExecutionController();
  await assert.rejects(
    () => controller.planExecution(input({
      drivers: [{ id: "android-vpn", capabilities: [], health: { state: "ready" }, canExecute: () => false, execute: async () => ({}) }],
      requiredCapabilities: ["application-scope"]
    })),
    /No available driver|cannot satisfy/
  );
  assert.equal(controller.state, ApplicationExecutionStates.FAILED);
});
