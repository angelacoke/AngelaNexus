import test from "node:test";
import assert from "node:assert/strict";

import {
  KERNEL_UPDATE_STATES,
  KERNEL_UPDATE_RISK,
  analyzeKernelAdapterImpact,
  buildKernelAdapterTestPlan,
  compareKernelVersions,
  createKernelUpdateCandidate,
  validateKernelUpdateGates,
} from "./kernel-update-manager.js";

test("kernel version comparison normalizes v-prefixes and patch versions", () => {
  assert.equal(compareKernelVersions("v1.14.2", "1.14.1"), 1);
  assert.equal(compareKernelVersions("26.3.27", "v26.3.27"), 0);
  assert.equal(compareKernelVersions("1.19.31", "1.19.32"), -1);
  assert.equal(compareKernelVersions("not-a-version", "1.0.0"), null);
});

test("adapter impact expands security and runtime changes into explicit review domains", () => {
  const impact = analyzeKernelAdapterImpact(
    [
      { filename: "core/transport/reality.go" },
      { filename: "runtime/engine.go" },
    ],
    "TLS and runtime compatibility changes"
  );

  assert.deepEqual(impact.domains.sort(), ["runtime", "security", "transport"]);
  assert.equal(impact.requiresManualAdapterReview, true);

  const plan = buildKernelAdapterTestPlan(impact);
  assert.equal(plan.manualReviewRequired, true);
  assert.ok(plan.checks.includes("unit-tests"));
  assert.ok(plan.checks.includes("compatibility-tests"));
  assert.ok(plan.checks.includes("kernel-conformance"));
});

test("current release remains current and does not create an update candidate", () => {
  const candidate = createKernelUpdateCandidate({
    kernel: "Mihomo",
    configuredVersion: "1.19.32",
    upstreamVersion: "1.19.32",
    release: { tag: "1.19.32", publishedAt: "2026-09-30T00:00:00Z" },
  });

  assert.equal(candidate.state, KERNEL_UPDATE_STATES.CURRENT);
  assert.equal(candidate.risk, KERNEL_UPDATE_RISK.LOW);
});

test("new upstream release creates a candidate with explicit gates", () => {
  const candidate = createKernelUpdateCandidate({
    kernel: "sing-box",
    configuredVersion: "1.14.1",
    upstreamVersion: "1.14.2",
    release: {
      tag: "1.14.2",
      publishedAt: "2026-09-24T00:00:00Z",
      body: "Routing and TLS changes",
    },
    changedFiles: [
      { filename: "route/router.go" },
      { filename: "transport/tls.go" },
    ],
  });

  assert.equal(candidate.state, KERNEL_UPDATE_STATES.CANDIDATE);
  assert.equal(candidate.risk, KERNEL_UPDATE_RISK.HIGH);
  assert.ok(candidate.requiredGates.includes("release-verified"));
  assert.ok(candidate.requiredGates.includes("user-approval"));
  assert.ok(candidate.testPlan.checks.includes("kernel-conformance"));
});

test("update approval cannot bypass required gates", () => {
  const incomplete = validateKernelUpdateGates({
    "release-verified": true,
    "adapter-impact-reviewed": true,
    "unit-tests": true,
  });

  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.missing.includes("compatibility-tests"));
  assert.ok(incomplete.missing.includes("kernel-conformance"));
  assert.ok(incomplete.missing.includes("security-review"));
  assert.ok(incomplete.missing.includes("user-approval"));

  const complete = validateKernelUpdateGates({
    "release-verified": true,
    "adapter-impact-reviewed": true,
    "unit-tests": true,
    "compatibility-tests": true,
    "kernel-conformance": true,
    "security-review": true,
    "user-approval": true,
  });

  assert.equal(complete.ok, true);
  assert.deepEqual(complete.missing, []);
});
