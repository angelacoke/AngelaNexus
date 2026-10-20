import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const steps = workflow.jobs.build.steps;
const bridge = read("native/android/mihomo-bridge/bridge.go");

test("CI stages and runs manager and actual tunnel regressions, rejecting empty selections", () => {
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.equal(host.if, "matrix.abi == 'x86_64'");
  assert.match(host.run, /late_connections_integration_test\.go.*tunnel\/statistic\/angelanexus_late_connections_test\.go/);
  assert.match(host.run, /late_tunnel_integration_test\.go.*tunnel\/angelanexus_late_tunnel_test\.go/);
  for (const prefix of ["TestAngelaNexusLateConnections", "TestAngelaNexusLateTunnel"]) {
    assert.ok(host.run.includes(`-list '^${prefix}'`));
    assert.ok(host.run.includes(`grep '^${prefix}'`));
    assert.ok(host.run.includes(`-run '^${prefix}' -count=1 -timeout=90s`));
  }
});

test("the source adapter alone applies the reviewed late patch before bridge staging", () => {
  const stage = steps.find(step => step.name === "Add AngelaNexus Android bridge");
  assert.ok(stage.run.indexOf("prepare-upstream.py") < stage.run.indexOf("mkdir ./angelanexus_android"));
  assert.doesNotMatch(stage.run, /git apply|patch --/);
  const prepare = read("native/android/mihomo-bridge/prepare-upstream.py");
  assert.ok(prepare.indexOf("apply_statistics(root)\n    apply_late(root)") > 0);
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  for (const path of ["late-connections.patch", "tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go"]) {
    assert.ok(provenance.run.includes(path), `missing build evidence: ${path}`);
  }
  assert.match(provenance.run, /"lateConnectionsPatch"/);
  assert.match(provenance.run, /"manager": \{"path": "tunnel\/statistic\/manager\.go"/);
  assert.match(provenance.run, /"tracker": \{"path": "tunnel\/statistic\/tracker\.go"/);
  assert.match(provenance.run, /"tunnel": \{"path": "tunnel\/tunnel\.go"/);
});

test("bridge closes registration before listener cleanup and reopens only on committed attachment", () => {
  const init = bridge.split("func init()")[1].split("func applyAndroidConfiguration")[0];
  assert.match(init, /DefaultManager\.StopRegistrations\(\)/);
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.ok(cleanup.indexOf("StopRegistrations()") < cleanup.indexOf("closeTun()"));
  assert.ok(cleanup.indexOf("StopRegistrations()") < cleanup.indexOf("DefaultManager.Range"));
  const start = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.ok(start.indexOf("syscall.Close(fd)") < start.indexOf("StartRegistrations()"));
  assert.equal((bridge.match(/\.StartRegistrations\(/g) || []).length, 1);
  assert.equal((bridge.match(/\.StopRegistrations\(/g) || []).length, 2);
});
