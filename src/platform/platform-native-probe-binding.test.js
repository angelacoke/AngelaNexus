import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlatformNativeProbeBinding,
} from "./platform-native-probe-binding.js";

function implementation(platform, capabilities = ["path-probe"]) {
  return {
    platform,
    capabilities,
    start() {},
    stop() {},
    getNetworkState() {},
    async probePath() {
      return { result: "success" };
    },
  };
}

test("binding reports native operation only when capability and implementation exist", () => {
  const binding = createPlatformNativeProbeBinding(implementation("android"));
  assert.equal(binding.supported, true);
  assert.deepEqual(binding.operations, ["probePath"]);
});

test("binding fails closed without path-probe capability", () => {
  const binding = createPlatformNativeProbeBinding(implementation("linux", []));
  assert.equal(binding.supported, false);
  assert.deepEqual(binding.operations, []);
});

test("binding fails closed when operation is absent", () => {
  const value = implementation("windows");
  delete value.probePath;
  const binding = createPlatformNativeProbeBinding(value);
  assert.equal(binding.supported, false);
});

test("all declared platform IDs have an explicit native operation contract", () => {
  for (const platform of ["android", "linux", "windows", "macos", "ios"]) {
    const binding = createPlatformNativeProbeBinding(implementation(platform));
    assert.equal(binding.supported, true);
  }
});
