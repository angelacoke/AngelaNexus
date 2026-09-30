import test from "node:test";
import assert from "node:assert/strict";
import {
  getSupportedPlatforms,
  getPlatformContract,
  isSupportedPlatform,
} from "../src/platform/target-contract.js";

test("the product target is one shared five-platform contract", () => {
  assert.deepEqual(getSupportedPlatforms(), [
    "android",
    "ios",
    "windows",
    "macos",
    "linux",
  ]);
});

test("every target keeps core, import and security behavior shared", () => {
  for (const platform of getSupportedPlatforms()) {
    const contract = getPlatformContract(platform);
    assert.equal(contract.sharedCore, true);
    assert.equal(contract.sharedImportPipeline, true);
    assert.equal(contract.sharedSecurityPolicy, true);
    assert.equal(contract.requiresNativeNetworkAdapter, true);
  }
});

test("mobile targets require an OS VPN integration boundary", () => {
  assert.equal(getPlatformContract("android").requiresVpnService, true);
  assert.equal(getPlatformContract("ios").requiresVpnService, true);
  assert.equal(getPlatformContract("windows").requiresVpnService, false);
  assert.equal(getPlatformContract("macos").requiresVpnService, false);
  assert.equal(getPlatformContract("linux").requiresVpnService, false);
});

test("unknown platforms are rejected rather than silently downgraded", () => {
  assert.equal(isSupportedPlatform("freebsd"), false);
  assert.throws(
    () => getPlatformContract("freebsd"),
    /unsupported platform/,
  );
});
