import test from "node:test";
import assert from "node:assert/strict";
import { getKernelSchema, listKernelSchemas } from "../src/core/schema-registry.js";
import { validateCompiledConfig } from "../src/core/compiled-config-validation.js";
import { Kernels } from "../src/core/model.js";

test("maintains one explicit schema baseline per kernel", () => {
  const schemas = listKernelSchemas();
  assert.equal(schemas.length, 3);
  for (const kernel of Object.values(Kernels)) {
    const schema = getKernelSchema(kernel);
    assert.equal(schema.kernel, kernel);
    assert.ok(schema.schemaId);
    assert.ok(schema.version);
  }
});

test("rejects an unmaintained kernel schema version", () => {
  assert.throws(
    () => getKernelSchema(Kernels.MIHOMO, "0.0.0"),
    /no maintained schema/
  );
});

test("compiled validation exposes the schema identity", () => {
  const result = validateCompiledConfig({
    proxies: [{
      name: "us",
      type: "socks",
      server: "example.com",
      port: 1080
    }]
  }, Kernels.MIHOMO);
  assert.equal(result.ok, true);
  assert.equal(result.schemaId, "mihomo.config.v1");
});

test("compiled validation fails closed when the required root collection is missing", () => {
  const result = validateCompiledConfig({}, Kernels.SING_BOX);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /sing-box\.config\.v1 requires array: outbounds/);
});

test("compiled validation checks Mihomo proxy-provider schema", () => {
  const missingUrl = validateCompiledConfig({
    "proxy-providers": {
      provider1: { type: "http" }
    }
  }, Kernels.MIHOMO);
  assert.equal(missingUrl.ok, false);
  assert.match(missingUrl.errors.join("\n"), /proxy-provider\[provider1\] requires url/);

  const validInline = validateCompiledConfig({
    "proxy-providers": {
      provider1: { type: "inline", payload: "proxies: []" }
    }
  }, Kernels.MIHOMO);
  assert.equal(validInline.ok, true);
});
