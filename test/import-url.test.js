import test from "node:test";
import assert from "node:assert/strict";
import { importConfigurationAsync } from "../src/core/import.js";

test("imports an HTTPS subscription URL through the bounded fetch pipeline", async () => {
  const result = await importConfigurationAsync("https://example.com/sub", {
    fetcher: async () => new Response("proxies:\n  - name: US-1\n    type: socks5\n    server: us.example\n    port: 1080", { status: 200 })
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.kernel, "mihomo");
  assert.equal(result.config.nodes.length, 1);
});

test("rejects subscription URLs with embedded credentials", async () => {
  await assert.rejects(
    () => importConfigurationAsync("https://user:pass@example.com/sub"),
    /embedded credentials/
  );
});

test("supports typed URL import sources", async () => {
  const result = await importConfigurationAsync({ type: "url", url: "https://example.com/sub" }, {
    fetcher: async () => new Response("proxies:\n  - name: JP-1\n    type: socks5\n    server: jp.example\n    port: 1080", { status: 200 })
  });
  assert.equal(result.config.nodes[0].name, "JP-1");
});


test("does not retain subscription query or fragment in source metadata", async () => {
  const result = await importConfigurationAsync("https://example.com/sub?token=secret#fragment", {
    fetcher: async () => new Response("proxies:\n  - name: US-1\n    type: socks5\n    server: us.example\n    port: 1080", { status: 200 })
  });
  assert.equal(result.config.metadata.sourceName, "https://example.com/sub");
  assert.equal(result.config.metadata.sourceName.includes("secret"), false);
  assert.equal(result.config.metadata.sourceName.includes("fragment"), false);
});
