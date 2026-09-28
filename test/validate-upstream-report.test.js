import test from "node:test";
import assert from "node:assert/strict";
import { validateUpstreamReport } from "../scripts/validate-upstream-report.mjs";

test("accepts a candidate when every automated test-plan check was executed", () => {
  const report = {
    kernels: [{
      kernel: "mihomo",
      state: "candidate",
      release: { prerelease: false },
      testPlan: { checks: ["unit-tests", "kernel-conformance"] }
    }]
  };
  const result = validateUpstreamReport(
    report,
    new Set(["release-verified", "unit-tests", "kernel-conformance"])
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("rejects a candidate when its test plan is not fully covered", () => {
  const report = {
    kernels: [{
      kernel: "sing-box",
      state: "candidate",
      release: { prerelease: false },
      testPlan: { checks: ["unit-tests", "compatibility-tests", "kernel-conformance"] }
    }]
  };
  const result = validateUpstreamReport(
    report,
    new Set(["release-verified", "unit-tests", "kernel-conformance"])
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(value => value.includes("compatibility-tests")));
});

test("rejects prerelease candidates", () => {
  const report = {
    kernels: [{
      kernel: "xray",
      state: "candidate",
      release: { prerelease: true },
      testPlan: { checks: ["unit-tests", "kernel-conformance"] }
    }]
  };
  const result = validateUpstreamReport(
    report,
    new Set(["unit-tests", "kernel-conformance"])
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(value => value.includes("prerelease")));
});
