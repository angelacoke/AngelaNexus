import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRuleSourceUpdateManager } from "../src/core/rule-source-update-manager.js";

function makeCandidate(privateKey, version, content = `payload-${version}`) {
  const bytes = Buffer.from(content, "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const signature = sign(null, Buffer.from(digest, "hex"), privateKey).toString("base64");
  return {
    content: bytes,
    metadata: {
      url: "https://rules.example.test/rules.dat",
      sha256: digest,
      signature,
      version,
      expiresAt: "2099-01-01T00:00:00.000Z"
    }
  };
}

function makeStore() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const trustPolicy = {
    trustedPublisher: { id: "test-publisher", algorithm: "ed25519", publicKey },
    requireHttpsForRemote: true,
    requireDigest: true,
    requireSignature: true,
    requireFreshness: true
  };
  return {
    privateKey,
    store: createRuleSourceUpdateManager({
      trustPolicy,
      now: () => Date.parse("2026-10-01T00:00:00.000Z"),
      semanticValidator(content) {
        return content.length > 0
          ? { ok: true, errors: [] }
          : { ok: false, errors: [{ code: "EMPTY_RULE_SOURCE" }] };
      }
    })
  };
}

test("accepts a verified candidate and atomically activates it", async () => {
  const { privateKey, store } = makeStore();
  const result = await store.update(() => makeCandidate(privateKey, 1, "rules-v1"));

  assert.equal(result.ok, true);
  assert.equal(result.action, "activated");
  assert.equal(store.getActive().metadata.version, 1);
  assert.equal(store.getStaged(), null);
  assert.equal(store.getActive().content.toString(), "rules-v1");
});

test("tampered content is rejected before activation", async () => {
  const { privateKey, store } = makeStore();
  await store.update(() => makeCandidate(privateKey, 1, "rules-v1"));

  const candidate = makeCandidate(privateKey, 2, "rules-v2");
  candidate.content = Buffer.from("tampered", "utf8");

  const result = await store.update(() => candidate);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "trust");
  assert.equal(store.getActive().metadata.version, 1);
  assert.equal(store.getActive().content.toString(), "rules-v1");
});

test("invalid signature cannot replace the active source", async () => {
  const { privateKey, store } = makeStore();
  await store.update(() => makeCandidate(privateKey, 1, "rules-v1"));

  const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");
  const candidate = makeCandidate(otherPrivateKey, 2, "rules-v2");
  const result = await store.update(() => candidate);

  assert.equal(result.ok, false);
  assert.equal(result.stage, "trust");
  assert.equal(store.getActive().metadata.version, 1);
});

test("rollback is rejected while the active source remains unchanged", async () => {
  const { privateKey, store } = makeStore();
  await store.update(() => makeCandidate(privateKey, 3, "rules-v3"));

  const result = await store.update(() => makeCandidate(privateKey, 2, "rules-v2"));
  assert.equal(result.ok, false);
  assert.ok(result.trust.errors.some(error => error.code === "RULE_SOURCE_ROLLBACK_REJECTED"));
  assert.equal(store.getActive().metadata.version, 3);
});

test("semantic validation failure cannot replace the active source", async () => {
  const { privateKey, store } = makeStore();
  await store.update(() => makeCandidate(privateKey, 1, "rules-v1"));

  const result = await store.update(() => makeCandidate(privateKey, 2, ""));
  assert.equal(result.ok, false);
  assert.equal(result.stage, "semantic");
  assert.equal(store.getActive().metadata.version, 1);
  assert.equal(store.getStaged(), null);
});

test("failed fetch cannot modify active or staged state", async () => {
  const { privateKey, store } = makeStore();
  await store.update(() => makeCandidate(privateKey, 1, "rules-v1"));

  const result = await store.update(async () => {
    throw new Error("network unavailable");
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "RULE_SOURCE_FETCH_FAILED");
  assert.equal(store.getActive().metadata.version, 1);
  assert.equal(store.getStaged(), null);
});
