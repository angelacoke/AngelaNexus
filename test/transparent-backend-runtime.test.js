import test from "node:test";
import assert from "node:assert/strict";
import {
  createTransparentProxyConfig,
  resolveTransparentBackend,
} from "../src/platform/transparent-proxy.js";

test("transparent runtime selector rejects unverified capability-gated backends", () => {
  const result = resolveTransparentBackend({
    platform: "windows",
    requiredCapabilities: ["tcp", "udp", "original-destination"],
    preferred: ["windows-wfp"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.backend, null);
  assert.equal(result.reason, "no-verified-backend");
});

test("transparent runtime selector honors verified backend evidence", () => {
  const result = resolveTransparentBackend({
    platform: "linux",
    requiredCapabilities: ["tcp", "udp", "original-destination", "policy-routing"],
    evidence: { "linux-tproxy": true },
    preferred: ["linux-tproxy"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.backend.id, "linux-tproxy");
});

test("transparent proxy configuration remains fail-closed", () => {
  const config = createTransparentProxyConfig({ enabled: true });
  assert.equal(config.security.failClosed, true);
  assert.equal(config.security.allowDirectFallback, false);
});

test("transparent runtime exposes capability truth instead of overclaiming health", () => {
  const result = resolveTransparentBackend({
    platform: "linux",
    requiredCapabilities: ["tcp", "udp", "original-destination", "policy-routing"],
    evidence: { "linux-tproxy": true },
    runtime: { operational: true, healthy: false },
    preferred: ["linux-tproxy"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.truth.state, "operational");
  assert.equal(result.truth.rank, 3);
});
