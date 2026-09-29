import test from "node:test";
import assert from "node:assert/strict";
import { getKernelUpstream, getKernelUpdatePolicy, UpstreamKernelNames } from "../src/core/kernel-registry.js";

test("kernel registry tracks three upstream stable baselines", () => {
  assert.deepEqual(UpstreamKernelNames, ["mihomo", "sing-box", "xray"]);
  assert.equal(getKernelUpstream("mihomo").stable, "1.19.31");
  assert.equal(getKernelUpstream("sing-box").stable, "1.14.1");
  assert.equal(getKernelUpstream("xray").stable, "26.3.27");
});

test("kernel updates never silently change the user's selected runtime", () => {
  const policy = getKernelUpdatePolicy();
  assert.equal(policy.automaticDiscovery, true);
  assert.equal(policy.automaticCandidatePreparation, true);
  assert.equal(policy.automaticUpgrade, false);
  assert.equal(policy.automaticRuntimeActivation, false);
  assert.equal(policy.automaticMerge, false);
  assert.equal(policy.notifyAvailableUpdate, true);
  assert.equal(policy.requireReleaseVerification, true);
  assert.equal(policy.requireAdapterImpactReview, true);
  assert.equal(policy.requireCompatibilityTests, true);
  assert.equal(policy.requireRuntimeConformance, true);
  assert.equal(policy.requireSecurityReview, true);
  assert.equal(policy.requireUserApproval, true);
  assert.equal(policy.preservePreviousStable, true);
});
