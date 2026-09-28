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
  assert.equal(first.context.reason, "network-generation-changed");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.context), true);
});

test("execution event ledger rejects malformed event types", () => {
  const ledger = createExecutionEventLedger();
  assert.throws(() => ledger.record(""), /event type/);
});
