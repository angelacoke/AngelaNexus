import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionEventLedger } from "../src/core/execution-event-ledger.js";

test("execution event ledger records bounded immutable security evidence", () => {
  let now = 1000;
  const ledger = createExecutionEventLedger({ maxEvents: 2, clock: () => ++now });
  const first = ledger.record("session-invalidated", { reason: "network-generation-changed" });
  ledger.record("session-invalidated", { reason: "gfw-path-revalidation-required" });
  ledger.record("session-invalidated", { reason: "second" });
  assert.equal(ledger.snapshot().length, 2);
  assert.equal(ledger.snapshot()[0].context.reason, "gfw-path-revalidation-required");
  assert.deepEqual(ledger.snapshot().map(event => event.id), ["2", "3"]);
  assert.equal(first.id, "1");
  assert.equal(first.context.reason, "network-generation-changed");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.context), true);
});

test("execution event ledger retains only the privacy-safe evidence schema", () => {
  const ledger = createExecutionEventLedger({ clock: () => 1000 });
  const source = {
    reason: "gfw-path-revalidation-required",
    kernel: "sing-box",
    decisionId: "decision-1",
    decisionVersion: 1,
    state: "stopping",
    config: { password: "must-not-retain" },
    payload: "must-not-retain",
    evidence: {
      state: "suspected",
      signals: ["tcp-reset"],
      actions: ["revalidate-path"],
      score: 3.5,
      confidence: 0.72,
      config: { token: "must-not-retain" }
    }
  };
  const event = ledger.record("session-invalidated", source);
  source.evidence.signals.push("mutated-after-record");
  assert.deepEqual(event.context, {
    reason: "gfw-path-revalidation-required",
    kernel: "sing-box",
    decisionId: "decision-1",
    decisionVersion: 1,
    state: "stopping",
    evidence: {
      state: "suspected",
      signals: ["tcp-reset"],
      actions: ["revalidate-path"],
      score: 3.5,
      confidence: 0.72
    }
  });
  assert.equal("config" in event.context, false);
  assert.equal(Object.isFrozen(event.context.evidence), true);
  assert.equal(Object.isFrozen(event.context.evidence.signals), true);
  assert.throws(() => event.context.evidence.signals.push("blocked"), TypeError);
});

test("execution event ledger rejects malformed event types", () => {
  const ledger = createExecutionEventLedger();
  assert.throws(() => ledger.record(""), /event type/);
});

test("execution event ledger bounds evidence values and rejects non-finite metrics", () => {
  const ledger = createExecutionEventLedger({ clock: () => Infinity });
  const event = ledger.record("session-invalidated", {
    reason: "r".repeat(400),
    kernel: "k".repeat(400),
    decisionId: "d".repeat(400),
    decisionVersion: -1,
    evidence: {
      state: "s".repeat(400),
      signals: Array.from({ length: 40 }, (_, index) => "signal-" + index),
      actions: Array.from({ length: 40 }, (_, index) => "action-" + index),
      score: Infinity,
      confidence: 2
    }
  });
  assert.equal(event.at, 0 + Date.now() >= 0, true);
  assert.equal(event.context.reason.length, 256);
  assert.equal(event.context.kernel.length, 256);
  assert.equal(event.context.decisionId.length, 256);
  assert.equal("decisionVersion" in event.context, false);
  assert.equal(event.context.evidence.state.length, 256);
  assert.equal(event.context.evidence.signals.length, 32);
  assert.equal(event.context.evidence.actions.length, 32);
  assert.equal("score" in event.context.evidence, false);
  assert.equal("confidence" in event.context.evidence, false);
});
