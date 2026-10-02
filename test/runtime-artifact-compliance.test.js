import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuntimeArtifactCompliance,
  requireRuntimeArtifactCompliance,
  isRuntimeArtifactReleaseReady,
} from "../src/kernel/runtime-artifact-compliance.js";

const base = {
  kernel: "mihomo",
  version: "1.19.32",
  commit: "88dcbf7f1614a67c3b36b848ee3592dfa92ada36",
  platform: "android",
  abi: "arm64-v8a",
  sourceUrl: "https://github.com/MetaCubeX/mihomo",
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  license: "GPL-3.0",
  linkage: "embedded",
  verification: "verified",
  sourceAvailable: true,
  provenanceVerified: true,
  licenseReviewed: true,
};

test("runtime artifact contract records immutable identity and compliance", () => {
  const record = createRuntimeArtifactCompliance(base);
  assert.equal(record.version, 1);
  assert.equal(record.artifact.commit, base.commit);
  assert.equal(record.artifact.sha256, base.sha256);
  assert.equal(record.compliance.linkage, "embedded");
  assert.equal(record.compliance.releaseReady, true);
});

test("artifact is not release-ready when license review is incomplete", () => {
  const record = createRuntimeArtifactCompliance({ ...base, licenseReviewed: false });
  assert.equal(record.compliance.releaseReady, false);
  assert.throws(
    () => requireRuntimeArtifactCompliance({ ...base, licenseReviewed: false }),
    /license-review/,
  );
  assert.equal(isRuntimeArtifactReleaseReady({ ...base, licenseReviewed: false }), false);
});

test("artifact verification is fail-closed when provenance or source is missing", () => {
  for (const patch of [{ provenanceVerified: false }, { sourceAvailable: false }, { verification: "unverified" }]) {
    assert.equal(isRuntimeArtifactReleaseReady({ ...base, ...patch }), false);
  }
});

test("invalid digest and linkage are rejected", () => {
  assert.throws(() => createRuntimeArtifactCompliance({ ...base, sha256: "bad" }), /sha256/);
  assert.throws(() => createRuntimeArtifactCompliance({ ...base, linkage: "static" }), /linkage/);
});
