import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountDataScope,
  classifySyncData,
  createAccountSnapshot,
  createBackupManifest,
  mergeAccountSnapshots,
  validateBackupManifest
} from "../src/core/account-sync.js";

test("account snapshot keeps shared data portable and platform state separate", () => {
  const snapshot = createAccountSnapshot({
    accountId: "acct-test",
    platform: "android",
    data: {
      profiles: [{ id: "p1" }],
      routingPolicies: { failClosed: true },
      platformState: { vpnPermission: "granted" },
      deviceSecrets: "must-not-sync"
    }
  });

  assert.equal(AccountDataScope.SHARED, "shared");
  assert.deepEqual(snapshot.shared.profiles, [{ id: "p1" }]);
  assert.deepEqual(snapshot.platform.android, { vpnPermission: "granted" });
  assert.equal(snapshot.deviceSecrets, undefined);
});

test("account snapshots merge shared data without overwriting unrelated platform state", () => {
  const android = createAccountSnapshot({ accountId: "acct-test", platform: "android", data: {
    profiles: [{ id: "p1" }], platformState: { vpnPermission: "granted" }
  }});
  const windows = createAccountSnapshot({ accountId: "acct-test", platform: "windows", data: {
    profiles: [{ id: "p2" }], platformState: { systemProxy: true }
  }});
  const merged = mergeAccountSnapshots(android, windows);

  assert.deepEqual(merged.shared.profiles, [{ id: "p2" }]);
  assert.deepEqual(merged.platform.android, { vpnPermission: "granted" });
  assert.deepEqual(merged.platform.windows, { systemProxy: true });
});

test("sync classification excludes credentials and device secrets from cloud data", () => {
  const result = classifySyncData({
    profiles: ["p1"],
    uiPreferences: { theme: "system" },
    secureCredentials: { token: "secret" },
    deviceSecrets: { key: "secret" },
    cache: { value: 1 }
  });
  assert.deepEqual(Object.keys(result.shared).sort(), ["profiles", "uiPreferences"]);
  assert.deepEqual(Object.keys(result.local).sort(), ["cache", "deviceSecrets", "secureCredentials"]);
});

test("backup manifest explicitly excludes device credentials", () => {
  const snapshot = createAccountSnapshot({ accountId: "acct-test", data: { profiles: [] } });
  const manifest = createBackupManifest(snapshot, { sourcePlatform: "android", appVersion: "0.1.0" });
  assert.equal(manifest.includes.secureCredentials, false);
  assert.equal(manifest.includes.deviceSecrets, false);
  assert.equal(validateBackupManifest(manifest).ok, true);
  assert.equal(validateBackupManifest({ ...manifest, includes: { ...manifest.includes, deviceSecrets: true } }).ok, false);
});
