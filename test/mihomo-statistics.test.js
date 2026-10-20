import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const steps = workflow.jobs.build.steps;

test("native workflow stages the statistics integration test and runs the race test on x86 host", () => {
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.equal(host.if, "matrix.abi == 'x86_64'");
  assert.match(host.run, /cp .*statistics_integration_test\.go.*tunnel\/statistic\/angelanexus_statistics_test\.go/);
  assert.match(host.run, /go test -race -run '\^TestAngelaNexusStatistics'/);
  assert.match(host.run, /-count=1/);
  assert.match(host.run, /-timeout=90s/);
  assert.match(host.run, /\.\/tunnel\/statistic/);
});

test("provenance workflow records the statistics patch and patched manager source", () => {
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  assert.match(provenance.run, /STATISTICS_PATCH_SHA256=.*sha256sum .*statistics\.patch/);
  assert.match(provenance.run, /PATCHED_STATISTICS_SHA256=.*sha256sum .*tunnel\/statistic\/manager\.go/);
  assert.match(provenance.run, /statisticsPatch/);
  assert.match(provenance.run, /native\/android\/mihomo-bridge\/statistics\.patch/);
  assert.match(provenance.run, /tunnel\/statistic\/manager\.go/);
});

test("bridge joins statistics during init and cleanup, and restarts only after attachment commits", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const init = bridge.split("func init()")[1].split("func applyAndroidConfiguration")[0];
  assert.match(init, /statistic\.DefaultManager\.StopStatistics\(\)/);
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.match(cleanup, /statistic\.DefaultManager\.StopStatistics\(\)/);
  assert.ok(cleanup.indexOf("StopStatistics()") < cleanup.indexOf("DefaultManager.Range"));
  const start = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.match(start, /statistic\.DefaultManager\.StartStatistics\(\)/);
  assert.ok(start.indexOf("syscall.Close(fd)") < start.indexOf("StartStatistics()"));
  assert.equal((bridge.match(/\.StartStatistics\(/g) || []).length, 1);
});
