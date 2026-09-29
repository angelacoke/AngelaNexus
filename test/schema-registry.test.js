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
    }],
    rules: ["MATCH,us"]
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
    },
    rules: ["MATCH,REJECT"]
  }, Kernels.MIHOMO);
  assert.equal(validInline.ok, true);
});

test("compiled validation enforces Mihomo fail-closed terminal routing", () => {
  const missingRules = validateCompiledConfig({
    proxies: [{ name: "us", type: "socks", server: "example.com", port: 1080 }]
  }, Kernels.MIHOMO);
  assert.equal(missingRules.ok, false);
  assert.match(missingRules.errors.join("\n"), /requires rules for fail-closed terminal routing/);

  const directFallback = validateCompiledConfig({
    proxies: [{ name: "us", type: "socks", server: "example.com", port: 1080 }],
    rules: ["MATCH,DIRECT"]
  }, Kernels.MIHOMO);
  assert.equal(directFallback.ok, false);
  assert.match(directFallback.errors.join("\n"), /forbids MATCH,DIRECT/);

  const safeTerminal = validateCompiledConfig({
    proxies: [{ name: "us", type: "socks", server: "example.com", port: 1080 }],
    rules: ["DOMAIN-SUFFIX,example.com,us", "MATCH,us"]
  }, Kernels.MIHOMO);
  assert.equal(safeTerminal.ok, true);
});


test("compiled validation enforces explicit fail-closed terminal routing for sing-box", () => {
  const missingFinal = validateCompiledConfig({
    outbounds: [{ type: "block", tag: "Nexus-Blackhole" }]
  }, Kernels.SING_BOX);
  assert.equal(missingFinal.ok, false);
  assert.match(missingFinal.errors.join("\n"), /requires an explicit route\.final/);

  const directFinal = validateCompiledConfig({
    outbounds: [{ type: "direct", tag: "Nexus-Direct" }],
    route: { final: "Nexus-Direct" }
  }, Kernels.SING_BOX);
  assert.equal(directFinal.ok, false);
  assert.match(directFinal.errors.join("\n"), /forbids a direct route\.final/);

  const safeFinal = validateCompiledConfig({
    outbounds: [{ type: "block", tag: "Nexus-Blackhole" }],
    route: { final: "Nexus-Blackhole" }
  }, Kernels.SING_BOX);
  assert.equal(safeFinal.ok, true);
});

test("compiled validation enforces explicit fail-closed terminal routing for Xray", () => {
  const missingTerminal = validateCompiledConfig({
    outbounds: [{ protocol: "blackhole", tag: "Nexus-Blackhole" }],
    routing: { rules: [] }
  }, Kernels.XRAY);
  assert.equal(missingTerminal.ok, false);
  assert.match(missingTerminal.errors.join("\n"), /requires a terminal routing rule/);

  const directTerminal = validateCompiledConfig({
    outbounds: [{ protocol: "freedom", tag: "Nexus-Direct" }],
    routing: { rules: [{ network: "tcp,udp", outboundTag: "Nexus-Direct" }] }
  }, Kernels.XRAY);
  assert.equal(directTerminal.ok, false);
  assert.match(directTerminal.errors.join("\n"), /forbids freedom as terminal fallback/);

  const safeTerminal = validateCompiledConfig({
    outbounds: [{ protocol: "blackhole", tag: "Nexus-Blackhole" }],
    routing: { rules: [{ network: "tcp,udp", outboundTag: "Nexus-Blackhole" }] }
  }, Kernels.XRAY);
  assert.equal(safeTerminal.ok, true);
});
