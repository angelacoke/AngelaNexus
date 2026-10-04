import { createExecutionEventLedger } from "./execution-event-ledger.js";
import { createApplicationExecutionEvidence, recordApplicationExecutionEvidence } from "./application-execution-evidence.js";

describe("application execution evidence", () => {
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

    expect(evidence.identityKey).toContain("android|com.example.app");
    expect(evidence.verificationStatus).toBe("verified");
    expect(JSON.stringify(evidence)).not.toContain("secret");
    expect(JSON.stringify(evidence)).not.toContain("must-not-be-stored");

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

    expect(event.type).toBe("application-execution");
    expect(event.context.evidence.state).toBe("verified");
    expect(event.context.evidence.actions).toContain("egress-verified");
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

    expect(event.context.evidence.state).toBe("unverified");
    expect(event.context.evidence.actions).toContain("egress-unverified");
  });
});
