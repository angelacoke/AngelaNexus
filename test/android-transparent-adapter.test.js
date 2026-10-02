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
