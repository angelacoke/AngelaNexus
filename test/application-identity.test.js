import test from "node:test";
import assert from "node:assert/strict";
import {
  applicationIdentityKey,
  createApplicationIdentity,
  getApplicationIdentityCapabilities,
  matchesApplicationIdentity,
  normalizeApplicationSelector,
} from "../src/core/application-identity.js";

test("normalizes Android package identity", () => {
  const identity = createApplicationIdentity({
    platform: "android",
    packageName: " com.example.app ",
    processName: "com.example.app",
  });
  assert.equal(identity.packageName, "com.example.app");
  assert.equal(identity.processName, "com.example.app");
  assert.equal(identity.platform, "android");
});

test("normalizes desktop process paths without conflating process identity", () => {
  const identity = createApplicationIdentity({
    platform: "windows",
    processName: "Example.exe",
    processPath: "C:\\Apps\\Example\\Example.exe",
  });
  assert.equal(identity.processPath, "C:/Apps/Example/Example.exe");
  assert.equal(applicationIdentityKey(identity).includes("Example.exe"), true);
});

test("matches selectors at application or process scope", () => {
  const identity = createApplicationIdentity({
    platform: "macos",
    bundleId: "com.example.client",
    processName: "ExampleClient",
    processPath: "/Applications/Example.app/Contents/MacOS/ExampleClient",
  });
  const selector = normalizeApplicationSelector({
    platform: "macos",
    bundleId: "com.example.client",
    processName: "ExampleClient",
  });
  assert.equal(matchesApplicationIdentity(identity, selector), true);
  assert.equal(matchesApplicationIdentity(identity, { bundleId: "com.other.client" }), false);
});

test("reports platform identity capabilities", () => {
  const android = getApplicationIdentityCapabilities("android");
  const windows = getApplicationIdentityCapabilities("windows");
  assert.equal(android.packageName, true);
  assert.equal(android.processPath, false);
  assert.equal(windows.processPath, true);
  assert.equal(windows.bundleId, false);
});

test("rejects an empty identity", () => {
  assert.throws(
    () => createApplicationIdentity({ platform: "linux" }),
    /at least one stable identifier/
  );
});
