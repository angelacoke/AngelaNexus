import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const steps = workflow.jobs.build.steps;

// These are integration-wiring checks, not native behavior tests. The workflow
// executes lifecycle_test.go against the actual helper with Go's race detector.
test("Mihomo JNI stop requires the error-returning export and releases its result", () => {
  const cpp = read("native/android/app/src/main/cpp/mihomo_jni.cpp");
  const stop = cpp.split("MihomoJniNativeHost_nativeStopTun")[1].split('extern "C"')[0];
  assert.match(stop, /using StopTun = char\* \(\*\)\(\)/);
  assert.match(stop, /resolve<StopTun>\("angelaStopTun"\)/);
  assert.match(stop, /stop == nullptr \|\| freeCString == nullptr/);
  assert.match(stop, /throwState\(env, chars\)/);
  assert.match(stop, /freeCString\(error\)/);
});

test("Mihomo native workflow tests and copies the same lifecycle helper it records", () => {
  const unit = steps.find(step => step.name === "Test Android lifecycle ownership and dial admission");
  assert.match(unit.run, /go test -race -v native\/android\/mihomo-bridge\/lifecycle\.go native\/android\/mihomo-bridge\/lifecycle_test\.go/);
  const copy = steps.find(step => step.name === "Add AngelaNexus Android bridge");
  assert.match(copy.run, /cp "\$GITHUB_WORKSPACE\/native\/android\/mihomo-bridge\/lifecycle\.go" \.\/angelanexus_android_lifecycle\.go/);
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  assert.match(provenance.run, /sha256sum "\$GITHUB_WORKSPACE\/native\/android\/mihomo-bridge\/lifecycle\.go"/);
  assert.match(provenance.run, /"lifecycle": \{"path": "native\/android\/mihomo-bridge\/lifecycle\.go", "sha256": "\$LIFECYCLE_SHA256"\}/);
});

test("Mihomo export verification checks every required symbol, including retry-aware stop", () => {
  const verify = steps.find(step => step.name === "Verify native artifact and generate provenance");
  assert.match(verify.run, /for symbol in angelaInit angelaApplyConfig startTUN angelaStopTun stopTun suspend forceGC getTraffic getTotalTraffic freeCString; do/);
  assert.match(verify.run, /grep -Eq "\[\[:space:\]\]\$\{symbol\}\$"/);
});
