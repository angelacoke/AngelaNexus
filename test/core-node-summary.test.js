import test from "node:test";
import assert from "node:assert/strict";
import { CORE_NODE_SUMMARY_LIMIT, projectCoreNodeSummaries } from "../src/platform/core-node-summary.js";

test("projects only bounded display-safe fields and omits credentials", () => {
  const result = projectCoreNodeSummaries({
    nodes: [{
      id: "node-1",
      name: "North America",
      protocol: "vless",
      endpoint: { server: "edge.example", port: 443 },
      auth: { username: "private-user", password: "private-password", uuid: "private-uuid" },
      tls: { serverName: "secret-sni", reality: { publicKey: "private-key" } },
      transport: { headers: { Authorization: "private-header" } },
    }],
  });

  assert.deepEqual(result, {
    nodeSummaries: [{
      name: "North America",
      protocol: "vless",
      server: "edge.example",
      port: 443,
    }],
    nodeSummariesTruncated: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /private-user|private-password|private-uuid|secret-sni|private-key|private-header/);
});

test("caps the preview and reports when canonical nodes were omitted", () => {
  const result = projectCoreNodeSummaries({
    nodes: Array.from({ length: CORE_NODE_SUMMARY_LIMIT + 3 }, (_, index) => ({
      name: "Node " + index,
      protocol: "socks",
      endpoint: { server: "edge.example", port: 1080 },
    })),
  });

  assert.equal(result.nodeSummaries.length, CORE_NODE_SUMMARY_LIMIT);
  assert.equal(result.nodeSummariesTruncated, true);
});

test("bounds display strings and fails closed for malformed canonical nodes", () => {
  const { nodeSummaries } = projectCoreNodeSummaries({
    nodes: [{ name: "n".repeat(200), protocol: "p".repeat(60), endpoint: { server: "s".repeat(300), port: 0 } }],
  });
  assert.equal(nodeSummaries[0].name.length, 160);
  assert.equal(nodeSummaries[0].protocol.length, 48);
  assert.equal(nodeSummaries[0].server.length, 253);
  assert.equal(nodeSummaries[0].port, null);
  assert.throws(() => projectCoreNodeSummaries({ nodes: [null] }), /invalid at index/);
  assert.throws(() => projectCoreNodeSummaries({ nodes: [{ protocol: "vless" }] }), /missing a display name/);
});
