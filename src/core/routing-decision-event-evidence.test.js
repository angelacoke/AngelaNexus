import assert from "node:assert/strict";
import test from "node:test";
import { createRoutingDecisionEventContext } from "./routing-decision-event-evidence.js";

test("routing decision event evidence is bounded and privacy-safe", () => {
  const context = createRoutingDecisionEventContext({
    status: "matched",
    reason: "matched-rules-converge-on-one-action",
    action: { type: "route", target: "proxy-us" },
    ruleIds: ["browser-app", "browser-process"],
    evidence: {
      mode: "rule",
      flow: {
        package_name: "com.example.browser",
        process_name: "browser",
        destination: { domain: "private.example.com" },
      },
      matches: [{ ruleId: "browser-app", match: { package_name: ["com.example.browser"] } }],
    },
  });

  assert.equal(context.state, "matched");
  assert.equal(context.reason, "matched-rules-converge-on-one-action");
  assert.deepEqual(context.evidence.actions, ["route"]);
  assert.equal(context.evidence.signals.includes("rule:browser-app"), true);
  assert.equal(context.evidence.signals.includes("rule:browser-process"), true);
  assert.equal(context.evidence.signals.some((item) => item.includes("private.example.com")), false);
  assert.equal(context.evidence.signals.some((item) => item.includes("com.example.browser")), false);
});

test("ambiguous routing decisions are explicitly logged as fail-closed", () => {
  const context = createRoutingDecisionEventContext({
    status: "ambiguous",
    reason: "multiple-matched-rules-have-conflicting-actions",
    action: null,
    ruleIds: ["a", "b"],
  });

  assert.deepEqual(context.evidence.actions, ["fail-closed"]);
});
