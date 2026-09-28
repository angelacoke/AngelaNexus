import test from "node:test";
import assert from "node:assert/strict";
import { createSensitiveSourceCarrier, getRuntimeSource } from "../src/core/sensitive-source.js";
import { importConfig } from "../src/core/import-pipeline.js";

const credential = "vless://REDACTED@example.com:443";

test("sensitive source carrier keeps raw source non-enumerable", () => {
  const carrier = createSensitiveSourceCarrier(credential);
  assert.equal(getRuntimeSource(carrier), credential);
  assert.equal(Object.keys(carrier).includes("runtimeSource"), false);
  assert.equal(JSON.stringify(carrier).includes(credential), false);
  assert.equal(carrier.credentialBearing, true);
});

test("import result does not serialize raw credential-bearing source", () => {
  const result = importConfig(credential);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(credential), false);
  assert.equal(result.sourceVault !== undefined, true);
  assert.equal(getRuntimeSource(result.sourceVault), credential);
  assert.equal(result.model.unifiedConfig.native.source.digest, result.sourceVault.digest);
  assert.equal(result.model.unifiedConfig.metadata.credentialBearing, true);
});
