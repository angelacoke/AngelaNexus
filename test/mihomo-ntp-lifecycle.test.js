import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const bridge = () => read("native/android/mihomo-bridge/bridge.go");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const host = () => workflow.jobs.build.steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");

test("NTP stop is explicit and owns cleanup pending state", () => {
  const source = bridge();
  const stop = source.split("func stopAndroidNTP(")[1]?.split("func ")[0];
  assert.ok(stop, "stopAndroidNTP must exist");
  assert.match(stop, /ntp\.StopNTPService\(ctx\)/);
  assert.match(stop, /androidRuntime\.ntpCleanupPending/);
  assert.doesNotMatch(stop, /closeAndroidResources\(\)/);
});

test("NTP pending state gates apply, DNS and start, then successful stop permits recreation", () => {
  const source = bridge();
  assert.match(source, /errAndroidNTPCleanupPending/);
  for (const fn of ["applyAndroidConfigJSON", "updateAndroidDNS", "startAndroidTUNWithConstructor"]) {
    const body = source.split(`func ${fn}`)[1]?.split("func ")[0];
    assert.ok(body, `${fn} must exist`);
    assert.match(body, /ntpCleanupPending|applyAndroidConfigJSONAtGeneration|updateAndroidDNSAtGeneration|startAndroidTUNAtGeneration/);
  }
  assert.ok((source.match(/ntpCleanupPending/g) ?? []).length >= 3);
  const stop = source.split("func stopAndroidNTP(")[1]?.split("func ")[0];
  assert.match(stop, /ntpCleanupPending\s*=\s*err\s*!=\s*nil/);
});

test("NTP lifecycle tests are staged and have non-empty race coverage", () => {
  const run = host()?.run ?? "";
  assert.match(run, /ntp_lifecycle_integration_test\.go.*\.\/ntp\/ntp/);
  assert.match(run, /bridge_ntp_integration_test\.go.*\.\/angelanexus_android/);
  assert.match(run, /go test -list '\^TestAngelaNexusNTP' \.\/ntp\/ntp \| grep/);
  assert.match(run, /go test -race -run '\^TestAngelaNexusNTP' -count=20 -timeout=120s \.\/ntp\/ntp/);
  assert.match(run, /go test .* -list '\^TestAndroidBridgeNTP' \.\/angelanexus_android \| grep/);
  assert.match(run, /go test -race .* -run '\^TestAndroidBridgeNTP' -count=20 -timeout=120s \.\/angelanexus_android/);
});

test("NTP service provenance is wired at both required levels", () => {
  const run = workflow.jobs.build.steps.find(step => step.name === "Generate native build provenance evidence")?.run ?? "";
  assert.match(run, /PATCHED_NTP_SERVICE_SHA256/);
  assert.match(run, /ntpService.*ntp\/ntp\/service\.go/);
  assert.match(run, /patchedSources.*ntpService/s);
});

test("NTP interruption regressions include real read, late dial, replacement and failed-close retry", () => {
  const source = read("native/android/mihomo-bridge/ntp_lifecycle_integration_test.go");
  for (const name of [
    "StopClosesAdmittedLoopbackUDPRead",
    "LateDialReturnedConnIsClosedWithoutWrite",
    "LateValidResponseCloseDoesNotInterruptRead",
    "ReloadKeepsReplacementAliveWhileOldCloseBlocks",
    "FailedRawCloseRequiresExplicitRetry",
  ]) {
    assert.match(source, new RegExp(`func TestAngelaNexusNTP${name}\\(`));
  }
  assert.match(source, /func \(c \*angelaReadEnteredConn\) Read\(/);
  assert.match(source, /UDP client did not enter the response read/);
});
