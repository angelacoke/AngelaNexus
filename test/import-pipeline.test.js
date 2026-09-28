import test from "node:test";
import assert from "node:assert/strict";
import { inspectImport, importConfig } from "../src/core/import-pipeline.js";

const CLASH = [
  "proxies:",
  "  - name: US-1",
  "    type: socks5",
  "    server: us.example",
  "    port: 1080",
  "  - name: JP-1",
  "    type: socks5",
  "    server: jp.example",
  "    port: 1080"
].join("\n");

test("import inspection automatically binds Clash YAML to Mihomo", () => {
  const result = inspectImport(CLASH);
  assert.equal(result.binding.kernel, "mihomo");
  assert.equal(result.binding.mode, "automatic");
  assert.equal(result.binding.requiresConfirmation, false);
  assert.equal(result.detection.kind, "clash-yaml");
});

test("import inspection resolves VLESS share links without kernel selection", () => {
  const result = inspectImport("vless://user@example.com:443?security=tls#US");
  assert.equal(result.binding.mode, "automatic");
  assert.equal(result.binding.requiresConfirmation, false);
  assert.equal(result.detection.protocol, "vless");
  assert.deepEqual(result.binding.candidates, ["mihomo", "sing-box", "xray"]);
});

test("automatic detection is exposed as an observable decision", () => {
  const result = inspectImport(CLASH);
  assert.equal(result.binding.decision.action, "kernel");
  assert.equal(result.binding.decision.requiresUserChoice, false);
  assert.deepEqual(result.binding.decision.options, ["mihomo"]);
});

test("multi-runtime detection remains automatic", () => {
  const result = inspectImport("vless://user@example.com:443?security=tls#US");
  assert.equal(result.binding.decision.action, "detectKernelCompatibility");
  assert.equal(result.binding.decision.requiresUserChoice, false);
  assert.deepEqual(result.binding.decision.options, ["mihomo", "sing-box", "xray"]);
});

test("explicit kernel binding is preserved and incompatible binding is rejected", () => {
  const explicit = inspectImport(CLASH, { kernel: "mihomo" });
  assert.equal(explicit.binding.kernel, "mihomo");
  assert.equal(explicit.binding.mode, "explicit");

  assert.throws(
    () => inspectImport(CLASH, { kernel: "xray" }),
    /selected kernel is incompatible with detected format/
  );
});

test("import produces a unified model without silently limiting nodes", () => {
  const result = importConfig(CLASH);
  assert.equal(result.model.nodeCount, 2);
  assert.equal(result.model.nodeLimit, null);
  assert.equal(result.model.unifiedConfig.kernel, "mihomo");
  assert.equal(result.model.unifiedConfig.nodes.length, 2);
});

test("import applies node limit only when explicitly supplied", () => {
  const result = importConfig(CLASH, { maxNodes: 1 });
  assert.equal(result.model.nodeCount, 1);
  assert.equal(result.model.nodeLimit, 1);
});

test("structured sing-box import excludes non-proxy outbounds", () => {
  const result = importConfig({
    inbounds: [],
    outbounds: [
      { type: "vless", tag: "us", server: "us.example", server_port: 443, uuid: "u1" },
      { type: "selector", tag: "auto", outbounds: ["us"] },
      { type: "direct", tag: "direct" }
    ],
    route: { rules: [] }
  }, { kernel: "sing-box" });

  assert.equal(result.model.nodeCount, 1);
  assert.equal(result.model.nodes[0].id, "us");
  assert.equal(result.model.unifiedConfig.kernel, "sing-box");
  assert.equal(result.model.unifiedConfig.groups.length, 1);
});


test("native source is preserved on import for lossless runtime handoff", () => {
  const input = {
    inbounds: [],
    outbounds: [{
      type: "vless",
      tag: "us",
      server: "us.example",
      server_port: 443,
      uuid: "u1",
      custom_native_field: { enabled: true }
    }],
    route: { rules: [] }
  };
  const result = importConfig(input);
  assert.equal(result.binding.kernel, "sing-box");
  assert.equal(result.model.unifiedConfig.native.format, "structured");
  assert.equal(result.model.unifiedConfig.native.runtimeCandidates[0], "sing-box");
  assert.equal(result.model.unifiedConfig.native.source.outbounds[0].custom_native_field.enabled, true);
});
