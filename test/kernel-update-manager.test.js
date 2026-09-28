import test from "node:test";
import assert from "node:assert/strict";
import {
  KERNEL_UPDATE_STATES,
  KERNEL_UPDATE_RISK,
  compareKernelVersions,
  assessAdapterImpact,
  createKernelUpdateCandidate,
  validateKernelUpdateGates
} from "../src/core/kernel-update-manager.js";

test("compares kernel versions without assuming SemVer prerelease syntax", () => {
  assert.equal(compareKernelVersions("1.19.31", "1.19.30"), 1);
  assert.equal(compareKernelVersions("1.14.2", "1.14.2"), 0);
  assert.equal(compareKernelVersions("26.9.8", "26.10.1"), -1);
});

test("classifies adapter impact from upstream changed files", () => {
  assert.equal(assessAdapterImpact(["README.md"]).risk, KERNEL_UPDATE_RISK.LOW);
  assert.equal(assessAdapterImpact(["docs/config.md", "route/schema.json"]).risk, KERNEL_UPDATE_RISK.MEDIUM);
  assert.equal(assessAdapterImpact(["core/transport/tls.go"]).risk, KERNEL_UPDATE_RISK.HIGH);
});

test("creates a candidate only when upstream is newer", () => {
  const candidate = createKernelUpdateCandidate({
    kernel: "mihomo",
    configuredVersion: "1.19.30",
    upstreamVersion: "1.19.31",
    release: { tag: "v1.19.31", prerelease: false },
    changedFiles: ["docs/config.md"]
  });
  assert.equal(candidate.state, KERNEL_UPDATE_STATES.CANDIDATE);
  assert.equal(candidate.risk, KERNEL_UPDATE_RISK.MEDIUM);
  assert.ok(candidate.requiredGates.includes("kernel-conformance"));
});

test("detects a registry that is ahead of upstream instead of downgrading", () => {
  const candidate = createKernelUpdateCandidate({
    kernel: "mihomo",
    configuredVersion: "1.19.31",
    upstreamVersion: "1.19.30"
  });
  assert.equal(candidate.state, KERNEL_UPDATE_STATES.REGISTRY_AHEAD);
});

test("requires every promotion gate", () => {
  const incomplete = validateKernelUpdateGates({ "release-verified": true });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.missing.includes("user-approval"));

  const complete = validateKernelUpdateGates({
    "release-verified": true,
    "adapter-impact-reviewed": true,
    "unit-tests": true,
    "compatibility-tests": true,
    "kernel-conformance": true,
    "security-review": true,
    "user-approval": true
  });
  assert.equal(complete.ok, true);
});
