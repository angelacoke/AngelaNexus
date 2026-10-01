import test from "node:test";
import assert from "node:assert/strict";
import { hasApplicationIdentity, hasWebIdentity, normalizeFlowIdentity } from "./flow-identity.js";

test("flow identity preserves independently observed application and web dimensions", () => {
  const identity = normalizeFlowIdentity({
    app: { packageId: "com.example.app", uid: 10042, evidence: ["os"] },
    process: { name: "Example", pid: 42 },
    domain: "API.Example.COM.",
    sni: "api.example.com",
    ip: "2001:DB8::1",
    port: "443",
    protocol: "TCP",
    transport: "TLS",
    source: "android-vpn",
  });

  assert.equal(identity.app.packageId, "com.example.app");
  assert.equal(identity.app.uid, 10042);
  assert.equal(identity.destination.domain, "api.example.com");
  assert.equal(identity.destination.sni, "api.example.com");
  assert.equal(identity.destination.ip, "2001:db8::1");
  assert.equal(identity.destination.port, 443);
  assert.equal(identity.destination.protocol, "tcp");
  assert.equal(identity.destination.transport, "tls");
  assert.equal(hasApplicationIdentity(identity), true);
  assert.equal(hasWebIdentity(identity), true);
});

test("flow identity does not invent missing application or web evidence", () => {
  const identity = normalizeFlowIdentity({ port: 443, protocol: "tcp" });

  assert.equal(identity.app.packageId, null);
  assert.equal(identity.app.bundleId, null);
  assert.equal(identity.app.uid, null);
  assert.equal(identity.destination.domain, null);
  assert.equal(identity.destination.sni, null);
  assert.equal(identity.dns.query, null);
  assert.equal(hasApplicationIdentity(identity), false);
  assert.equal(hasWebIdentity(identity), false);
});

test("flow identity keeps multiple DNS answers without selecting one", () => {
  const identity = normalizeFlowIdentity({
    dns: { query: "www.example.com", answers: ["192.0.2.1", "2001:DB8::2"] },
  });

  assert.deepEqual(identity.dns.answers, ["192.0.2.1", "2001:db8::2"]);
});
