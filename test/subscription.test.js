import test from "node:test";
import assert from "node:assert/strict";
import { fetchSubscription, parseSubscription } from "../src/core/subscription.js";

test("parses Clash YAML and only limits nodes when the user opts in", () => {
  const yaml = [
    "proxies:",
    "  - name: US-1",
    "    type: socks5",
    "    server: us.example",
    "    port: 1080",
    "  - name: US-1",
    "    type: socks5",
    "    server: us.example",
    "    port: 1080",
    "  - name: JP-1",
    "    type: socks5",
    "    server: jp.example",
    "    port: 1080",
    "  - name: SG-1",
    "    type: socks5",
    "    server: sg.example",
    "    port: 1080"
  ].join("\n");

  const allNodes = parseSubscription(yaml);
  assert.deepEqual(allNodes.map((n) => n.name), ["US-1", "JP-1", "SG-1"]);

  const limitedNodes = parseSubscription(yaml, { maxNodes: 2 });
  assert.deepEqual(limitedNodes.map((n) => n.name), ["US-1", "JP-1"]);
});

test("parses multiple share links without exposing the URI as the node id", () => {
  const nodes = parseSubscription("vless://user@example.com:443?security=tls#US\\nvless://user@example.org:443?security=tls#JP");
  assert.equal(nodes.length, 2);
  assert.match(nodes[0].id, /^share-[0-9a-f]+$/);
  assert.notEqual(nodes[0].id, nodes[0].uri);
});

test("parses share links", () => {
  const nodes = parseSubscription("vless://user@example.com:443?security=tls#US");
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].protocol, "vless");
  assert.equal(nodes[0].server, "example.com");
  assert.equal(nodes[0].name, "US");
});

test("normalizes structured nodes through the shared config pipeline", () => {
  const nodes = parseSubscription(JSON.stringify({ outbounds: [
    { tag: "us-1", type: "vless", server: "us.example", server_port: 443 },
    { tag: "direct", type: "direct" },
    { tag: "us-1", type: "vless", server: "duplicate.example", server_port: 443 }
  ] }));
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, "us-1");
  assert.equal(nodes[0].protocol, "vless");
});

test("validates every subscription redirect and rejects embedded redirect credentials", async () => {
  const calls = [];
  const responses = [
    { status: 302, ok: false, headers: new Map([["location", "/next"]]) },
    { status: 200, ok: true, text: async () => "proxies:\n  - name: US-1\n    type: socks5\n    server: us.example\n    port: 1080" }
  ];
  const result = await fetchSubscription("https://source.example/config", {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    }
  });
  assert.match(result, /US-1/);
  assert.equal(calls[0].url, "https://source.example/config");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[1].url, "https://source.example/next");

  await assert.rejects(
    fetchSubscription("https://source.example/config", {
      fetcher: async () => ({ status: 302, ok: false, headers: new Map([["location", "https://user:pass@target.example/secret"]]) })
    }),
    /subscription URL must not contain embedded credentials/
  );
});
