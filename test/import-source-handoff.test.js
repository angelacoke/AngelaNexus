import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "../src/core/import-pipeline.js";

const content = "proxies:\n  - name: source-proxy\n    type: socks5\n    server: proxy.example\n    port: 1080\n";
const trafficAcceptance = { required: true, targetUrl: "https://example.test/health", timeoutMs: 1000 };
const sources = [
  ["text", content],
  ["file", { type: "file", name: "profile.yaml", content }],
  ["URL", "https://example.test/subscription"],
  ["structured", { proxies: [{ name: "source-proxy", type: "socks5", server: "proxy.example", port: 1080 }] }],
];

for (const [name, source] of sources) {
  test(`importSource preserves explicit runtime handoff for ${name}`, async () => {
    const result = await importSource(source, {
      kernel: "mihomo",
      prepareRuntimeHandoff: true,
      trafficAcceptance,
      fetcher: async () => ({ ok: true, text: async () => content }),
    });
    assert.equal(result.runtimeHandoff.kernel, "mihomo");
    assert.equal(result.runtimeHandoff.compilerValidation.ok, true);
    assert.match(result.runtimeHandoff.configuration, /source-proxy/);
    assert.deepEqual(result.runtimeHandoff.executionIntent.metadata.trafficAcceptance, trafficAcceptance);
  });
}

test("importSource does not prepare execution unless explicitly requested", async () => {
  const result = await importSource(content);
  assert.equal(result.runtimeHandoff, null);
});
