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


import {
  sealRuleVersionState,
  verifyRuleVersionStateEnvelope,
  restoreRuleVersionState
} from "../src/core/rule-version-policy.js";

test("sealed state detects tampering", async () => {
  const state = createRuleVersionState();
  await acceptRulePackageVersion(await withChecksum(base), state);
  const sealed = await sealRuleVersionState(state, { generation: 1 });
  const tampered = { ...sealed, records: [] };
  const result = await verifyRuleVersionStateEnvelope(tampered);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "checksum-mismatch");
});

test("state anchor rejects rollback", async () => {
  const state = createRuleVersionState();
  await acceptRulePackageVersion(await withChecksum(base), state);
  const first = await sealRuleVersionState(state, { generation: 4 });
  const nextState = createRuleVersionState(await (async () => {
    const record = state.records.get("AngelaNexus:platform/security");
    return [{ ...record, version: 2 }];
  })());
  const next = await sealRuleVersionState(nextState, { generation: 5, previousChecksum: first.checksum });
  const result = await verifyRuleVersionStateEnvelope(first, { anchor: { generation: 5, checksum: next.checksum } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "state-rollback");
  const restored = await restoreRuleVersionState(next, { anchor: { generation: 4, checksum: first.checksum } });
  assert.equal(restored.records.get("AngelaNexus:platform/security").version, 2);
});

test("same generation requires the anchored checksum", async () => {
  const state = createRuleVersionState();
  await acceptRulePackageVersion(await withChecksum(base), state);
  const sealed = await sealRuleVersionState(state, { generation: 7 });
  const altered = sealed;
  const result = await verifyRuleVersionStateEnvelope(altered, { anchor: { generation: 7, checksum: "a".repeat(64) } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "anchor-conflict");
});
