import test from "node:test";
import assert from "node:assert/strict";
import { preflightUnifiedConfig } from "../src/core/compile-preflight.js";
import { Kernels } from "../src/core/model.js";

test("preflight accepts a maintained simple configuration", () => {
  const result = preflightUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "us-1", protocol: "socks", server: "example.com", port: 1080 }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.schemaId, "mihomo.config.v1");
});

test("preflight reports unsupported protocol with stable diagnostic code", () => {
  const result = preflightUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{ id: "h2", protocol: "hysteria2", server: "example.com", port: 443 }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "PROTOCOL_UNSUPPORTED" || item.code === "PROTOCOL_UNKNOWN"));
});

test("preflight reports unsupported feature combinations", () => {
  const result = preflightUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{
      id: "v",
      protocol: "vless",
      server: "example.com",
      port: 443,
      uuid: "u",
      tls: { enabled: true, serverName: "example.com" },
      multiplex: true
    }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "FEATURE_UNKNOWN"));
});

test("preflight reports combination constraints", () => {
  const result = preflightUnifiedConfig({
    kernel: Kernels.MIHOMO,
    nodes: [{
      id: "a",
      protocol: "anytls",
      server: "example.com",
      port: 443,
      tls: { reality: { enabled: true } }
    }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "MIHOMO_ANYTLS_REALITY_UNSUPPORTED"));
});

test("preflight invalid input exposes its diagnostic", () => {
  const result = preflightUnifiedConfig(null, Kernels.MIHOMO);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "CONFIG_INVALID");
});

test("compiler exposes preflight diagnostics on successful compilation", async () => {
  const { compileUnifiedConfig } = await import("../src/core/config-compiler.js");
  const result = compileUnifiedConfig({
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "us-1", protocol: "socks", server: "example.com", port: 1080 }]
  });
  assert.equal(result.preflight.ok, true);
  assert.equal(result.preflight.schemaId, "sing-box.config.v1");
});

test("compiler fails closed with structured preflight diagnostics", async () => {
  const { compileUnifiedConfig } = await import("../src/core/config-compiler.js");
  assert.throws(() => compileUnifiedConfig({
    kernel: Kernels.XRAY,
    nodes: [{ id: "h2", protocol: "hysteria2", server: "example.com", port: 443 }]
  }), (error) => {
    assert.equal(error.code, "NEXUS_PREFLIGHT_FAILED");
    assert.ok(Array.isArray(error.diagnostics));
    assert.ok(error.diagnostics.length > 0);
    return true;
  });
});

test("preflight enforces the system GFW security floor", () => {
  const result = preflightUnifiedConfig({
    kernel: Kernels.MIHOMO,
    security: {
      gfwResilience: {
        enabled: false,
        failClosed: false
      }
    },
    nodes: [{ id: "us-1", protocol: "socks", server: "example.com", port: 1080 }]
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "GFW_RESILIENCE_REQUIRED"));
  assert.ok(result.errors.some((item) => item.code === "GFW_FAIL_CLOSED_REQUIRED"));
});
