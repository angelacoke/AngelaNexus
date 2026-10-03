import test from "node:test";
import assert from "node:assert/strict";
import {
  createRuleTrustStore,
  resolveRuleTrustKey,
  verifyRuleSignatureAgainstTrustStore
} from "../src/core/rule-trust.js";

const active = {
  keyId: "angelanexus/rules-2026",
  publisher: "AngelaNexus",
  algorithm: "test",
  status: "active",
  createdAt: "2026-10-03T00:00:00Z",
  expiresAt: "2027-10-03T00:00:00Z"
};

test("trust store rejects duplicate key identifiers", () => {
  assert.throws(
    () => createRuleTrustStore([active, active]),
    /duplicate rule trust keyId/
  );
});

test("revoked keys cannot authorize rule signatures", () => {
  const store = createRuleTrustStore([{
    ...active,
    status: "revoked",
    revokedAt: "2026-10-03T12:00:00Z"
  }]);
  const result = resolveRuleTrustKey(store, {
    keyId: active.keyId,
    publisher: active.publisher,
    algorithm: active.algorithm,
    at: "2026-10-03T13:00:00Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "revoked-key");
});

test("expired keys cannot authorize rule signatures", () => {
  const store = createRuleTrustStore([active]);
  const result = resolveRuleTrustKey(store, {
    keyId: active.keyId,
    publisher: active.publisher,
    algorithm: active.algorithm,
    at: "2027-10-03T00:00:00Z"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired-key");
});

test("publisher and algorithm are bound to the trust key", () => {
  const store = createRuleTrustStore([active]);
  assert.equal(resolveRuleTrustKey(store, {
    keyId: active.keyId,
    publisher: "OtherPublisher",
    algorithm: "test"
  }).reason, "publisher-mismatch");
  assert.equal(resolveRuleTrustKey(store, {
    keyId: active.keyId,
    publisher: active.publisher,
    algorithm: "other"
  }).reason, "algorithm-mismatch");
});

test("signature verification receives the resolved trust anchor", async () => {
  const store = createRuleTrustStore([active]);
  let received = null;
  const result = await verifyRuleSignatureAgainstTrustStore(store, {
    publisher: active.publisher,
    algorithm: active.algorithm,
    keyId: active.keyId,
    value: "signature",
    payload: "payload",
    verifySignature: async args => {
      received = args;
      return args.key.keyId === active.keyId;
    }
  });
  assert.equal(result.ok, true);
  assert.equal(received.key.keyId, active.keyId);
});
