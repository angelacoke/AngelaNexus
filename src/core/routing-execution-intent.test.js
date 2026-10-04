import assert from "node:assert/strict";
import test from "node:test";
import { createRoutingExecutionIntent, validateRoutingExecutionIntent } from "./routing-execution-intent.js";

test("route decision becomes a kernel-neutral proxy intent", () => {
  const intent = createRoutingExecutionIntent({
    action: { type: "route", target: "proxy-us" },
    ruleIds: ["app-browser"],
    reason: "matched-rules-converge-on-one-action",
  });

  assert.equal(intent.kind, "routing-execution-intent");
  assert.equal(intent.mode, "proxy");
  assert.equal(intent.target, "proxy-us");
  assert.deepEqual(intent.ruleIds, ["app-browser"]);
  assert.equal(intent.kernel, undefined);
  assert.equal(validateRoutingExecutionIntent(intent).ok, true);
});

test("bypass and reject remain explicit execution intents", () => {
  const bypass = createRoutingExecutionIntent({ action: { type: "bypass", target: "direct" } });
  const reject = createRoutingExecutionIntent({ action: { type: "reject" } });

  assert.equal(bypass.mode, "direct");
  assert.equal(reject.mode, "reject");
  assert.equal(validateRoutingExecutionIntent(bypass).ok, true);
  assert.equal(validateRoutingExecutionIntent(reject).ok, true);
});

test("chain intent requires explicit ordered hops", () => {
  const intent = createRoutingExecutionIntent({
    action: { type: "chain", hops: ["node-a", "node-b"] },
  });

  assert.equal(intent.mode, "chain");
  assert.deepEqual(intent.hops, ["node-a", "node-b"]);
  assert.equal(validateRoutingExecutionIntent(intent).ok, true);
});

test("conflicting routing decisions cannot become an execution intent", () => {
  assert.throws(
    () => createRoutingExecutionIntent({
      status: "ambiguous",
      action: null,
    }),
    /unsupported routing decision action/
  );
});

test("intent creation does not select a kernel", () => {
  const intent = createRoutingExecutionIntent({
    action: { type: "route", target: "proxy-us" },
  }, {
    application: { platform: "android", package_name: "com.example.app" },
  });

  assert.equal(Object.hasOwn(intent, "kernel"), false);
  assert.deepEqual(intent.application, {
    platform: "android",
    package_name: "com.example.app",
  });
});
