import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = "native/android/mihomo-bridge/";

test("named UDP bridge race regressions remain in the production host CI package", () => {
  const workflow = read(".github/workflows/mihomo-android-native-build.yml");
  assert.match(workflow, /cp .*bridge_named_udp_integration_test\.go.*angelanexus_android\/bridge_named_udp_integration_test\.go/);
  assert.match(workflow, /-race .*?-run '\^TestAndroidBridgeNamedInbound' -count=20/);
  assert.match(workflow, /test-named-udp-stop\.py.*--logs/);
  const bridge = read(`${base}bridge_named_udp_integration_test.go`);
  for (const name of ["PacketTimeoutRequiresRetry", "WriteBackTimeoutRequiresRetry", "HandlerTimeoutRequiresRetry", "DefaultRegistryIsolation", "RealTunnelRoundTripAcrossStop", "StopFailureRetainsDebt"]) {
    assert.match(bridge, new RegExp(`func TestAndroidBridgeNamedInboundUDP${name}\\(`));
  }
  assert.match(bridge, /namedinbound\.NewMixed/);
  assert.match(bridge, /m\.Listen\(tunnel\)/);
  assert.match(bridge, /stopAndroidNamed\(10 \* time\.Millisecond\)/);
  assert.match(bridge, /bridgeNamedUDPConfigJSON\(t, addr\)/);
});

test("named UDP negative controls reject missing ownership and all three join acknowledgements", () => {
  const negative = read(`${base}test-named-udp-stop.py`);
  for (const name of ["legacy-unowned-constructor", "default-registry-capture", "premature-packet-drain", "premature-writeback-drain", "premature-handler-drain", "forgotten-timed-out-generation"]) {
    assert.ok(negative.includes(name), name);
  }
  assert.match(negative, /range\(1, 4\)/);
  assert.match(negative, /host source differs from exact production bridge projection/);
  assert.match(negative, /source differs from reviewed production digest/);
  assert.match(negative, /DATA RACE\|panic:\|test timed out\|build failed\|no tests to run/);
  assert.match(negative, /finally:[\s\S]*path\.write_text\(originals\[path\]\)/);
});

test("named UDP documentation preserves limited shutdown and device acceptance boundary", () => {
  const doc = read("native/README.md");
  assert.match(doc, /without registering in the default\nmixed-port UDP registry/);
  assert.match(doc, /retained packets until\n`Drop`/);
  assert.match(doc, /stop fixture itself is not evidence of authentication correctness/);
  assert.match(doc, /separate `auth-state\.patch` publishes the four fields/);
  assert.match(doc, /complete kernel shutdown and\nAndroid\/JNI real-device acceptance remain outside this boundary/);
});
