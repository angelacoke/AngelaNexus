import test from "node:test";
import assert from "node:assert/strict";
import { calculateRulePackageChecksum } from "../src/core/rule-library.js";
import { createRuleVersionState, inspectRulePackageVersion, acceptRulePackageVersion } from "../src/core/rule-version-policy.js";

const base = {
  id: "platform/security",
  version: 1,
  schemaVersion: 1,
  source: "builtin",
  publisher: "AngelaNexus",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  rules: [{ id: "security/block-test", matchType: "domain", action: "reject", value: "example.test" }]
};

async function withChecksum(pkg) {
  return { ...pkg, checksum: await calculateRulePackageChecksum(pkg) };
}

test("first version is accepted", async () => {
  const state = createRuleVersionState();
  const pkg = await withChecksum(base);
  const result = await acceptRulePackageVersion(pkg, state);
  assert.equal(result.action, "first-seen");
  assert.equal(state.records.get("AngelaNexus:platform/security").version, 1);
});

test("higher version upgrades", async () => {
  const state = createRuleVersionState([{ publisher: "AngelaNexus", id: base.id, version: 1, checksum: "a".repeat(64) }]);
  const pkg = await withChecksum({ ...base, version: 2, updatedAt: "2026-10-03T01:00:00Z" });
  const result = await acceptRulePackageVersion(pkg, state);
  assert.equal(result.action, "upgrade");
  assert.equal(state.records.get("AngelaNexus:platform/security").version, 2);
});

test("lower version is rejected", async () => {
  const state = createRuleVersionState();
  const current = await withChecksum({ ...base, version: 2 });
  await acceptRulePackageVersion(current, state);
  const old = await withChecksum({ ...base, version: 1, updatedAt: "2026-10-02T00:00:00Z" });
  await assert.rejects(() => acceptRulePackageVersion(old, state), error => error.decision.action === "stale-version");
});

test("same version with same checksum is idempotent", async () => {
  const pkg = await withChecksum(base);
  const state = createRuleVersionState();
  await acceptRulePackageVersion(pkg, state);
  const result = await acceptRulePackageVersion(pkg, state);
  assert.equal(result.action, "same-version");
});

test("publisher is part of package identity", async () => {
  const pkg = await withChecksum(base);
  const state = createRuleVersionState();
  await acceptRulePackageVersion(pkg, state);
  const other = await withChecksum({ ...base, publisher: "OtherPublisher" });
  const result = await inspectRulePackageVersion(other, state);
  assert.equal(result.action, "first-seen");
});
