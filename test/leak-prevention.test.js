import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLeakRisk, isLeakSafe, assertLeakSafe, LeakActions } from "../src/core/leak-prevention.js";

test("unknown paths fail closed", () => {
  const result = evaluateLeakRisk({ transport: "tcp", path: "unknown" });
  assert.equal(result.allowed, false);
  assert.equal(result.action, LeakActions.REJECT);
});

test("IPv6 cannot bypass the managed path", () => {
  const result = evaluateLeakRisk({ transport: "tcp", addressFamily: "ipv6", path: "direct" });
  assert.equal(result.allowed, false);
});

test("DNS bootstrap must remain protected", () => {
  const result = evaluateLeakRisk(
    { transport: "dns", bootstrap: true, path: "managed" },
    { secureDnsBootstrap: false }
  );
  assert.equal(result.allowed, false);
});

test("direct UDP is rejected by default", () => {
  const result = evaluateLeakRisk({ transport: "udp", path: "direct" });
  assert.equal(result.allowed, false);
});

test("direct QUIC is rejected by default", () => {
  const result = evaluateLeakRisk({ transport: "quic", path: "direct" });
  assert.equal(result.allowed, false);
});

test("managed proxy and chain paths are accepted", () => {
  assert.equal(isLeakSafe({ transport: "tcp", path: "proxy" }), true);
  assert.equal(isLeakSafe({ transport: "tcp", path: "chain" }), true);
});

test("non-sensitive explicit direct traffic remains representable", () => {
  const result = evaluateLeakRisk({ transport: "tcp", path: "direct" });
  assert.equal(result.allowed, true);
  assert.equal(result.action, LeakActions.DIRECT);
});

test("assertLeakSafe exposes a machine-readable failure", () => {
  assert.throws(
    () => assertLeakSafe({ transport: "dns", path: "direct" }),
    (error) => error && error.code === "UNSAFE_NETWORK_PATH"
  );
});
