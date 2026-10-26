import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { AdapterCapabilities, adapterFor, hasAdapterCapability } from "../src/adapters/index.js";
import { getKernelUpstream } from "../src/core/kernel-registry.js";

for (const kernel of Object.values(Kernels)) {
  test(kernel + " exposes the unified adapter contract", () => {
    const adapter = adapterFor(kernel);
    assert.equal(adapter.kernel, kernel);
    assert.equal(typeof adapter.compileChain, "function");
    assert.equal(hasAdapterCapability(adapter, AdapterCapabilities.CHAIN_COMPILE), true);
  });
}

test("adapter lookup rejects unknown kernels", () => {
  assert.equal(adapterFor("unknown"), null);
});

test("version-aware compiled validation reports the pinned upstream baseline", async () => {
  const { validateCompiledConfig } = await import("../src/core/compiled-config-validation.js");
  const result = validateCompiledConfig({ outbounds: [{ type: "block", tag: "Nexus-Blackhole" }], route: { final: "Nexus-Blackhole" } }, Kernels.SING_BOX);
  assert.equal(result.ok, true);
  assert.equal(result.version, getKernelUpstream(Kernels.SING_BOX).stable);
});

test("sing-box Hysteria requires current auth and TLS fields", async () => {
  const { validateCompiledConfig } = await import("../src/core/compiled-config-validation.js");
  const result = validateCompiledConfig({
    outbounds: [{
      type: "hysteria",
      tag: "h",
      server: "example.com",
      server_port: 443,
      auth_str: "secret",
      tls: {}
    }],
    route: { final: "h" }
  }, Kernels.SING_BOX);
  assert.equal(result.ok, true);
});

test("sing-box rejects invalid Reality short_id length", async () => {
  const { validateCompiledConfig } = await import("../src/core/compiled-config-validation.js");
  const result = validateCompiledConfig({
    outbounds: [{
      type: "vless",
      tag: "v",
      server: "example.com",
      server_port: 443,
      uuid: "00000000-0000-4000-8000-000000000000",
      tls: { reality: { enabled: true, public_key: "key", short_id: "0123456789abcdef" } }
    }]
  }, Kernels.SING_BOX);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /short_id/);
});

test("compiled validation rejects unknown sing-box outbound types", async () => {
  const { validateCompiledConfig } = await import("../src/core/compiled-config-validation.js");
  const result = validateCompiledConfig({
    outbounds: [{ type: "not-a-real-outbound", tag: "x" }]
  }, Kernels.SING_BOX);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /unsupported outbound type/);
});

test("compiled validation rejects unknown Xray protocols", async () => {
  const { validateCompiledConfig } = await import("../src/core/compiled-config-validation.js");
  const result = validateCompiledConfig({
    outbounds: [{ protocol: "not-a-real-protocol", tag: "x" }]
  }, Kernels.XRAY);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /unsupported protocol/);
});
