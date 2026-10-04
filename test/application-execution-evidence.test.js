import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionEventLedger } from "../src/core/execution-event-ledger.js";
import { createApplicationExecutionEvidence, recordApplicationExecutionEvidence } from "../src/core/application-execution-evidence.js";

  test("joins identity, policy, driver and verified egress without secrets", () => {
    const ledger = createExecutionEventLedger({ clock: () => 1000 });
    const evidence = createApplicationExecutionEvidence({
      identity: { platform: "android", packageName: "com.example.app", processName: "com.example.app" },
      scope: "application",
      policy: { action: "proxy", ruleId: "app-rule-1", matched: true },
      driver: { id: "android-vpn" },
      kernel: "xray",
      decisionId: "decision-7",
      executionStatus: "active",
      verification: { status: "verified", reason: "egress matched expected path", password: "secret" },
      password: "secret",
      payload: "must-not-be-stored",
    });

    assert.match(evidence.identityKey, /android\\|com\\.example\\.app/);
    assert.equal(evidence.verificationStatus, "verified");
    assert.doesNotMatch(JSON.stringify(evidence), /secret/);
    assert.doesNotMatch(JSON.stringify(evidence), /must-not-be-stored/);

    const event = recordApplicationExecutionEvidence(ledger, {
      identity: { platform: "android", packageName: "com.example.app" },
      scope: "application",
      policy: { action: "proxy", ruleId: "app-rule-1", matched: true },
      driver: { id: "android-vpn" },
      kernel: "xray",
      decisionId: "decision-7",
      executionStatus: "active",
      verification: { status: "verified" },
    });

    assert.equal(event.type, "application-execution");
    assert.equal(event.context.evidence.state, "verified");
    assert.ok(event.context.evidence.actions.includes("egress-verified"));
  });

  test("records unverified execution explicitly", () => {
    const ledger = createExecutionEventLedger();
    const event = recordApplicationExecutionEvidence(ledger, {
      identity: { platform: "windows", executable: "C:\\Apps\\demo.exe", processName: "demo.exe" },
      scope: "process",
      policy: { action: "proxy", matched: true },
      driver: { id: "windows-process-proxy" },
      executionStatus: "planned",
      verification: { status: "unverified" },
    });

    assert.equal(event.context.evidence.state, "unverified");
    assert.ok(event.context.evidence.actions.includes("egress-unverified"));
  });
