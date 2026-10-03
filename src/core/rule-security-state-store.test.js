import test from "node:test";
import assert from "node:assert/strict";
import { createRuleVersionState, acceptRulePackageVersion } from "./rule-version-policy.js";
import {
  RULE_SECURITY_STATE_CAPABILITIES,
  createRuleSecurityStateStore,
  loadRuleSecurityState,
  persistRuleSecurityState
} from "./rule-security-state-store.js";

const base = {
  id: "platform/security",
  version: 1,
  schemaVersion: 1,
  source: "builtin",
  publisher: "AngelaNexus",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  rules: [{ id: "baseline", matchType: "domain", action: "direct", value: "example.com" }]
};

async function state() {
  const value = createRuleVersionState();
  await acceptRulePackageVersion({ ...base, checksum: "a".repeat(64) }, value);
  return value;
}

function memoryStore(capability, initialEnvelope = null, initialAnchor = null) {
  let envelope = initialEnvelope;
  let anchor = initialAnchor;
  return {
    store: createRuleSecurityStateStore({
      capability,
      loadEnvelope: async () => envelope,
      saveEnvelope: async value => { envelope = value; },
      loadAnchor: async () => anchor,
      saveAnchor: async value => { anchor = value; }
    }),
    read: () => ({ envelope, anchor })
  };
}

test("secure-anchor store refuses to load without an anchor", async () => {
  const memory = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR);
  const current = await state();
  const first = await persistRuleSecurityState(memory.store, current, { generation: 1 });
  const broken = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR, first.envelope, null);
  await assert.rejects(
    loadRuleSecurityState(broken.store),
    error => error.code === "NEXUS_RULE_SECURITY_ANCHOR_UNAVAILABLE"
  );
});

test("secure-anchor store rejects generation rollback before persistence", async () => {
  const memory = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR);
  const current = await state();
  const first = await persistRuleSecurityState(memory.store, current, { generation: 4 });
  const snapshot = memory.read();
  await assert.rejects(
    persistRuleSecurityState(memory.store, current, { generation: 4 }),
    error => error.code === "NEXUS_RULE_SECURITY_STATE_ROLLBACK"
  );
  assert.deepEqual(memory.read(), snapshot);
  assert.equal(first.anchor.generation, 4);
});

test("integrity-only capability is explicit and can restore verified state", async () => {
  const memory = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.INTEGRITY_ONLY);
  const current = await state();
  await persistRuleSecurityState(memory.store, current, { generation: 1 });
  const loaded = await loadRuleSecurityState(memory.store, { requireSecureAnchor: true });
  assert.equal(loaded.capability, RULE_SECURITY_STATE_CAPABILITIES.INTEGRITY_ONLY);
  assert.equal(loaded.verification.ok, true);
});

test("corrupted envelope is rejected and never restored", async () => {
  const memory = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.INTEGRITY_ONLY);
  const current = await state();
  const saved = await persistRuleSecurityState(memory.store, current, { generation: 1 });
  memory.store.saveEnvelope = async value => { void value; };
  const corrupted = { ...saved.envelope, generation: 2 };
  const broken = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.INTEGRITY_ONLY, corrupted);
  await assert.rejects(
    loadRuleSecurityState(broken.store),
    error => error.code === "NEXUS_RULE_SECURITY_STATE_REJECTED"
  );
});

test("failed secure persistence does not advance the stored anchor", async () => {
  const memory = memoryStore(RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR);
  const current = await state();
  await persistRuleSecurityState(memory.store, current, { generation: 1 });
  const before = memory.read();
  const failing = createRuleSecurityStateStore({
    capability: RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR,
    loadEnvelope: before.store?.loadEnvelope || (async () => before.envelope),
    saveEnvelope: async () => { throw new Error("simulated write failure"); },
    loadAnchor: async () => before.anchor,
    saveAnchor: async value => { before.anchor = value; }
  });
  await assert.rejects(
    persistRuleSecurityState(failing, current, { generation: 2 }),
    /simulated write failure/
  );
  assert.equal(before.anchor.generation, 1);
});
