import test from "node:test";
import assert from "node:assert/strict";
import { createGfwRuntime, GfwSignals } from "../src/core/gfw-policy.js";
import { createPathTrustSession, PathTrustStates } from "../src/core/path-trust.js";
import { bindGfwPathTrust } from "../src/core/gfw-path-trust.js";

test("GFW revalidation evidence invalidates the kernel-neutral path trust session", () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  const baseline = {
    networkId: "wifi-1",
    networkGeneration: 1,
    routeId: "route-1",
    dnsPathId: "dns-1",
    destinationId: "dest-1",
    transport: "tcp",
    certificateId: "cert-1",
    bootstrapId: "boot-1"
  };

  pathTrust.establish(baseline);
  assert.equal(pathTrust.snapshot().invalidated, false);

  const unsubscribe = bindGfwPathTrust(gfw, pathTrust);
  const evidence = gfw.observe({ signal: GfwSignals.TCP_RESET, transport: "tcp" }, 100000);

  assert.ok(evidence.actions.includes("revalidate-path"));
  assert.equal(pathTrust.snapshot().invalidated, true);

  const snapshot = pathTrust.snapshot();
  assert.equal(snapshot.expected.routeId, "route-1");
  unsubscribe();
});

test("GFW path-trust binding rejects invalid inputs", () => {
  const gfw = createGfwRuntime();
  assert.throws(() => bindGfwPathTrust(null, createPathTrustSession()), /GFW runtime/);
  assert.throws(() => bindGfwPathTrust(gfw, null), /path trust session/);
});

test("GFW-triggered invalidation uses fail-closed path trust state", () => {
  const gfw = createGfwRuntime();
  const pathTrust = createPathTrustSession();
  pathTrust.establish({
    networkId: "n1",
    networkGeneration: 1,
    routeId: "r1",
    dnsPathId: "d1",
    destinationId: "x1",
    transport: "tls",
    certificateId: "c1",
    bootstrapId: "b1"
  });

  bindGfwPathTrust(gfw, pathTrust);
  gfw.observe({ signal: GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE }, 100000);

  const result = pathTrust.validate({
    networkId: "n1",
    networkGeneration: 1,
    routeId: "r1",
    dnsPathId: "d1",
    destinationId: "x1",
    transport: "tls",
    certificateId: "c1",
    bootstrapId: "b1"
  });

  assert.equal(result.trusted, true);
  assert.equal(pathTrust.snapshot().invalidated, false);
  assert.equal(result.state, PathTrustStates.TRUSTED);
});
