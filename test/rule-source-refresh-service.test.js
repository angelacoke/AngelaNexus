import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createRuleSourceRefreshService } from "../src/core/rule-source-refresh-service.js";

function candidate(privateKey, version, content) {
  const bytes = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    content: bytes,
    metadata: {
      url: "https://rules.example.test/rules.dat",
      sha256,
      signature: sign(null, Buffer.from(sha256, "hex"), privateKey).toString("base64"),
      version,
      expiresAt: "2099-01-01T00:00:00.000Z"
    }
  };
}

function setup() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    service: createRuleSourceRefreshService({
      trustPolicy: {
        trustedPublisher: { id: "publisher", algorithm: "ed25519", publicKey },
        requireHttpsForRemote: true,
        requireDigest: true,
        requireSignature: true,
        requireFreshness: true
      },
      now: () => Date.parse("2026-10-01T00:00:00.000Z"),
      semanticValidator(content) {
        return content.length ? { ok: true, errors: [] } : { ok: false, errors: [{ code: "EMPTY_RULE_SOURCE" }] };
      }
    })
  };
}

test("refresh service activates only a fully verified rule source", async () => {
  const { privateKey, service } = setup();
  const result = await service.refresh(() => candidate(privateKey, 1, "rules-v1"));
  assert.equal(result.ok, true);
  assert.equal(result.action, "activated");
  assert.equal(service.snapshot().state, "active");
  assert.equal(service.getActive().content.toString(), "rules-v1");
});

test("failed verification leaves the active source untouched", async () => {
  const { privateKey, service } = setup();
  await service.refresh(() => candidate(privateKey, 1, "rules-v1"));

  const bad = candidate(privateKey, 2, "rules-v2");
  bad.content = Buffer.from("tampered", "utf8");

  const result = await service.refresh(() => bad);
  assert.equal(result.ok, false);
  assert.equal(result.stage, "trust");
  assert.equal(service.getActive().metadata.version, 1);
  assert.equal(service.getActive().content.toString(), "rules-v1");
  assert.equal(service.snapshot().state, "rejected");
});

test("concurrent refresh calls share one update transaction", async () => {
  const { privateKey, service } = setup();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fetcher = async () => {
    calls += 1;
    await gate;
    return candidate(privateKey, 1, "rules-v1");
  };

  const first = service.refresh(fetcher);
  const second = service.refresh(fetcher);
  release();

  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(service.getActive().metadata.version, 1);
});
