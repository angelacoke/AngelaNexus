import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePathProbeStates,
  createNativePathProbeDriver,
  getNativePathProbeDriverModes,
} from "./native-path-probe-driver.js";

function implementation(platform, capabilities = ["path-probe"]) {
  return {
    platform,
    capabilities,
    start() {},
    stop() {},
    getNetworkState() {},
    async probePath(task) {
      return { result: "success", mode: task.mode };
    },
  };
}

test("driver binds declared native probe operation without inventing capability", async () => {
  const driver = createNativePathProbeDriver(implementation("android"), { mode: "non-root" });
  assert.equal(driver.state, NativePathProbeStates.READY);
  assert.equal(driver.mode, "non-root");
  const result = await driver.probe({ pathId: "p1" });
  assert.equal(result.result, "success");
  assert.equal(result.mode, "non-root");
});

test("driver exposes platform mode constraints", () => {
  assert.deepEqual(getNativePathProbeDriverModes("android"), ["non-root", "root"]);
  assert.deepEqual(getNativePathProbeDriverModes("windows"), ["native"]);
  assert.deepEqual(getNativePathProbeDriverModes("ios"), ["native"]);
});

test("missing native capability is fail-closed", () => {
  const driver = createNativePathProbeDriver(implementation("linux", []), { mode: "root" });
  assert.equal(driver.state, NativePathProbeStates.UNSUPPORTED);
  assert.equal(driver.supported, false);
  assert.equal(driver.probe, null);
});

test("invalid native result is normalized", async () => {
  const driver = createNativePathProbeDriver({
    ...implementation("macos"),
    async probePath() {
      return null;
    },
  });
  const result = await driver.probe({ pathId: "p1" });
  assert.equal(result.result, "failure");
  assert.equal(result.reason, "invalid-native-result");
});
