import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../core/model.js";
import { createApplicationRoutingIdentity } from "../core/application-routing.js";
import { createRoutingExecutionIntent } from "../core/routing-execution-intent.js";
import { createAndroidRoutingExecution, validateAndroidRoutingExecution } from "./android-routing-execution.js";

test("translates routing intent into Android TUN execution without selecting a kernel", () => {
  const execution = createAndroidRoutingExecution({
    intent: createRoutingExecutionIntent({
      status: "matched",
      action: { type: "route", target: "proxy-us" },
      ruleIds: ["browser-app"],
      reason: "application-rule",
    }),
    transparentMode: "system",
  });

  assert.equal(execution.platform, "android");
  assert.equal(execution.executionMode, "proxy");
  assert.equal(execution.target, "proxy-us");
  assert.equal(execution.controls.kernelSelection, "deferred-to-capability-scheduler");
  assert.equal(execution.kernel, undefined);
});

test("preserves application and observed process identity as routing selectors", () => {
  const application = createApplicationRoutingIdentity({
    id: "android:browser",
    platform: "android",
    packageName: "com.example.browser",
    processName: "com.example.browser",
    processPath: "/data/app/browser/base.apk",
  });
  const execution = createAndroidRoutingExecution({
    intent: createRoutingExecutionIntent({
      status: "matched",
      action: { type: "route", target: "proxy-us" },
      reason: "application-process-rule",
    }),
    application,
    observedProcessName: "com.example.browser:proxy",
  });

  assert.deepEqual(execution.selectors.packageNames, ["com.example.browser"]);
  assert.deepEqual(execution.selectors.processNames, ["com.example.browser", "com.example.browser:proxy"]);
  assert.deepEqual(execution.selectors.processPaths, ["/data/app/browser/base.apk"]);
});

test("preserves ordered chain hops and remains kernel-neutral", () => {
  const execution = createAndroidRoutingExecution({
    intent: createRoutingExecutionIntent({
      status: "matched",
      action: { type: "chain", hops: ["node-a", "node-b"] },
      reason: "application-chain",
    }),
    transparentMode: "system",
  });

  assert.deepEqual(execution.hops, ["node-a", "node-b"]);
  assert.equal(execution.intent.kernel, undefined);
});

test("fails closed for an unsupported transparent mode", () => {
  const result = validateAndroidRoutingExecution({
    intent: createRoutingExecutionIntent({
      status: "matched",
      action: { type: "reject" },
      reason: "policy-reject",
    }),
    transparentMode: "unknown",
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /unsupported Android transparent mode/);
});
