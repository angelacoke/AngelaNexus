import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  applicationArtifactDigest,
  verifyApplicationManifest,
  verifyApplicationArtifacts
} from "../src/core/application-integrity.js";

function signedManifest(manifest, privateKey) {
  const entries = manifest.artifacts.map((item) => ({
    path: String(item.path),
    sha256: String(item.sha256).toLowerCase()
  })).sort((a,b)=>a.path.localeCompare(b.path));
  const canonical = JSON.stringify({ version: manifest.version, artifacts: entries });
  return sign(null, Buffer.from(applicationArtifactDigest(canonical), "hex"), privateKey).toString("base64");
}

test("application manifest and artifacts require independent verification", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const app = "trusted-app";
  const manifest = {
    version: 2,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    artifacts: [{ path: "app.bin", sha256: applicationArtifactDigest(app) }]
  };
  const signature = signedManifest(manifest, privateKey);
  assert.equal(verifyApplicationManifest(manifest, { signature, publicKey, currentVersion: 1 }).ok, true);
  assert.equal(verifyApplicationArtifacts(manifest, new Map([["app.bin", app]])).ok, true);
});

test("application artifact tampering is rejected", () => {
  const manifest = {
    version: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    artifacts: [{ path: "app.bin", sha256: applicationArtifactDigest("trusted") }]
  };
  const result = verifyApplicationArtifacts(manifest, new Map([["app.bin", "tampered"]]));
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "APP_INTEGRITY_ARTIFACT_MISMATCH");
});

test("manifest rollback and missing trust anchor are rejected", () => {
  const manifest = {
    version: 1,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    artifacts: [{ path: "app.bin", sha256: applicationArtifactDigest("trusted") }]
  };
  const result = verifyApplicationManifest(manifest, { currentVersion: 2 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((x) => x.code === "APP_INTEGRITY_ROLLBACK_REJECTED"));
  assert.ok(result.errors.some((x) => x.code === "APP_INTEGRITY_TRUST_ANCHOR_MISSING"));
});
