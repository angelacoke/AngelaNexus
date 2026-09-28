import test from "node:test";
import assert from "node:assert/strict";
import { createSessionInvalidationSource } from "../src/core/session-invalidation.js";

test("composes multiple invalidation sources and unsubscribes in reverse order", async () => {
  const events = [];
  const unsubscribed = [];
  const sourceA = async listener => { events.push(["subscribe", "a"]); listener("a"); return async () => unsubscribed.push("a"); };
  const sourceB = async listener => { events.push(["subscribe", "b"]); listener("b"); return async () => unsubscribed.push("b"); };
  const subscribe = createSessionInvalidationSource(sourceA, sourceB);
  const unsubscribe = await subscribe(reason => events.push(["event", reason]));
  assert.deepEqual(events, [["subscribe", "a"], ["event", "a"], ["subscribe", "b"], ["event", "b"]]);
  await unsubscribe();
  assert.deepEqual(unsubscribed, ["b", "a"]);
});

test("rolls back earlier subscriptions when a later source fails", async () => {
  let rolledBack = 0;
  const sourceA = async () => async () => { rolledBack += 1; };
  const sourceB = async () => { throw new Error("subscribe failed"); };
  await assert.rejects(
    createSessionInvalidationSource(sourceA, sourceB)(() => {}),
    /subscribe failed/
  );
  assert.equal(rolledBack, 1);
});

test("rejects a source that does not return an unsubscribe function", async () => {
  await assert.rejects(
    createSessionInvalidationSource(async () => null)(() => {}),
    /unsubscribe function/
  );
});
