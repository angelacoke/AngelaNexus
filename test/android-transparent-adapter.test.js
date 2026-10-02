import test from "node:test";
import assert from "node:assert/strict";
import {
  ANDROID_TRANSPARENT_MODES,
  inspectAndroidTransparentCapabilities,
  selectAndroidTransparentMode,
  createAndroidRootTransaction,
} from "../src/platform/android-transparent-adapter.js";

test("android adapter exposes capability-driven auto mode", () => {
  const capabilities = inspectAndroidTransparentCapabilities({ root: true, "root-authorized": true, tcp: true, udp: true, dns: true, ipv4: true, ipv6: true, "uid-identity": true, "process-identity": true, "policy-routing": true, "atomic-rollback": true });
  assert.equal(selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.AUTO, capabilities).selected, "root");
});

test("root mode does not require optional process identity", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.ROOT, {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "process-identity": false,
    "policy-routing": true,
    "atomic-rollback": true,
  });
  assert.equal(result.selected, "root");
  assert.equal(result.reason, "root-capability-ready");
});

test("root mode fails closed when root is unavailable", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.ROOT, { systemVpn: true });
  assert.equal(result.selected, "unavailable");
  assert.equal(result.failClosed, true);
});

test("system mode does not depend on root", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.SYSTEM, { systemVpn: true });
  assert.equal(result.selected, "system");
});

test("root transaction rolls back after commit failure", () => {
  const calls = [];
  const transaction = createAndroidRootTransaction({
    prepare: () => calls.push("prepare"),
    commit: () => { calls.push("commit"); throw new Error("apply failed"); },
    rollback: () => calls.push("rollback"),
  });
  transaction.prepare();
  assert.throws(() => transaction.commit(), /apply failed/);
  assert.deepEqual(calls, ["prepare", "commit", "rollback"]);
});

test("explicit root request remains unavailable when a required routing capability is missing", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.ROOT, {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "policy-routing": false,
    "atomic-rollback": true,
    systemVpn: true,
  });
  assert.equal(result.selected, "unavailable");
  assert.equal(result.failClosed, true);
});

test("auto mode falls back to system VPN only when root evidence is incomplete", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.AUTO, {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "policy-routing": false,
    "atomic-rollback": true,
    systemVpn: true,
  });
  assert.equal(result.selected, "system");
  assert.equal(result.failClosed, true);
});

test("android root selection exposes verified but not operational truth", () => {
  const result = selectAndroidTransparentMode(ANDROID_TRANSPARENT_MODES.ROOT, {
    root: true,
    "root-authorized": true,
    tcp: true,
    udp: true,
    dns: true,
    ipv4: true,
    ipv6: true,
    "uid-identity": true,
    "policy-routing": true,
    "atomic-rollback": true,
  });
  assert.equal(result.truth.state, "verified");
  assert.equal(result.truth.ok, true);
});
