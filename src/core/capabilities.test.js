import test from "node:test";
import assert from "node:assert/strict";
import { evaluateNodeCapabilities, NodeCapabilities } from "./capabilities.js";
import { Kernels } from "./model.js";

test("identifies QUIC and UDP capabilities for Hysteria2 and TUIC", () => {
  for (const protocol of ["hysteria2", "tuic"]) {
    const result = evaluateNodeCapabilities({
      protocol,
      endpoint: { server: "example.com" },
      tls: { enabled: true }
    }, Kernels.MIHOMO);

    assert.equal(result.ok, true);
    assert.equal(result.data.capabilities.includes(NodeCapabilities.UDP), true);
    assert.equal(result.data.capabilities.includes(NodeCapabilities.QUIC), true);
  }
});

test("does not infer an IP family from a domain name", () => {
  const result = evaluateNodeCapabilities({
    protocol: "vless",
    endpoint: { server: "example.com" }
  }, Kernels.MIHOMO);

  assert.equal(result.data.capabilities.includes(NodeCapabilities.IPV4), false);
  assert.equal(result.data.capabilities.includes(NodeCapabilities.IPV6), false);
});

test("detects literal IPv4 and IPv6 endpoint families", () => {
  const ipv4 = evaluateNodeCapabilities({
    protocol: "vless",
    endpoint: { server: "203.0.113.10" }
  }, Kernels.MIHOMO);
  const ipv6 = evaluateNodeCapabilities({
    protocol: "vless",
    endpoint: { server: "2001:db8::10" }
  }, Kernels.MIHOMO);

  assert.equal(ipv4.data.capabilities.includes(NodeCapabilities.IPV4), true);
  assert.equal(ipv4.data.capabilities.includes(NodeCapabilities.IPV6), false);
  assert.equal(ipv6.data.capabilities.includes(NodeCapabilities.IPV6), true);
  assert.equal(ipv6.data.capabilities.includes(NodeCapabilities.IPV4), false);
});

test("detects explicit chain configuration without making it a protocol requirement", () => {
  const result = evaluateNodeCapabilities({
    protocol: "vless",
    endpoint: { server: "example.com" },
    "dialer-proxy": "upstream"
  }, Kernels.MIHOMO);

  assert.equal(result.ok, true);
  assert.equal(result.data.capabilities.includes(NodeCapabilities.CHAIN), true);
});

test("rejects Mihomo AnyTLS with Reality according to current upstream documentation", () => {
  const result = evaluateNodeCapabilities({
    protocol: "anytls",
    endpoint: { server: "example.com" },
    tls: { enabled: true, reality: { enabled: true } }
  }, Kernels.MIHOMO);

  assert.equal(result.ok, false);
  assert.equal(result.data.unsupported.includes("combination:anytls+reality"), true);
});
