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
  assert.match(copy.run, /cp "\$GITHUB_WORKSPACE\/native\/android\/mihomo-bridge\/lifecycle\.go" \.\/angelanexus_android\/lifecycle\.go/);
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  assert.match(provenance.run, /sha256sum "\$GITHUB_WORKSPACE\/native\/android\/mihomo-bridge\/lifecycle\.go"/);
  assert.match(provenance.run, /"lifecycle": \{"path": "native\/android\/mihomo-bridge\/lifecycle\.go", "sha256": "\$LIFECYCLE_SHA256"\}/);
});

test("Mihomo export verification checks every required symbol, including retry-aware stop", () => {
  const verify = steps.find(step => step.name === "Verify native artifact and generate provenance");
  assert.match(verify.run, /for symbol in angelaInit angelaApplyConfig startTUN angelaStopTun stopTun suspend forceGC getTraffic getTotalTraffic freeCString; do/);
  assert.match(verify.run, /grep -Eq "\[\[:space:\]\]\$\{symbol\}\$"/);
});

test("Mihomo host bridge regression uses pinned source and restores the Android build constraint", () => {
  const host = steps.find(step => step.name === "Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.equal(host.if, "matrix.abi == 'x86_64'");
  assert.equal(host["working-directory"], "${{ runner.temp }}/mihomo");
  assert.match(host.run, /sed '1,2d' "\$GITHUB_WORKSPACE\/native\/android\/mihomo-bridge\/bridge\.go"/);
  assert.match(host.run, /trap 'cp .*bridge\.go" \.\/angelanexus_android\/bridge\.go' EXIT/);
  assert.match(host.run, /cp .*bridge_integration_test\.go" \.\/angelanexus_android\/bridge_integration_test\.go/);
  assert.match(host.run, /go test -race -tags=with_gvisor,cmfa -run '\^TestAndroidBridge' -count=1 -timeout=90s -v \.\/angelanexus_android\s*$/m);
  assert.ok(steps.indexOf(host) < steps.findIndex(step => step.name === "Build native shared object"));
});

test("Mihomo bridge keeps stopped configuration and explicit resume from reopening tunnel admission", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const apply = bridge.split("func applyAndroidConfiguration")[1].split("//export angelaInit")[0];
  assert.match(apply, /defer func\(\) \{\s*if !androidRuntime\.protected\.Load\(\) \{\s*tunnel\.OnSuspend\(\)/);
  assert.equal((bridge.match(/applyAndroidConfiguration\(cfg\)/g) ?? []).length, 2);
  const stop = bridge.split("func stopTunError")[1].split("//export angelaStopTun")[0];
  assert.ok(stop.indexOf("tunnel.OnSuspend()") < stop.indexOf("closeAndroidResources()"));
  const resume = bridge.split("func suspend(")[1].split("//export forceGC")[0];
  assert.match(resume, /androidTunMu\.Lock\(\)/);
  assert.match(resume, /suspended != 0 \|\| !androidRuntime\.protected\.Load\(\)/);
});

test("Mihomo stop and replacement close visible trackers even after listener failure", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.match(cleanup, /listenerErr := androidRuntime\.closeTun\(\)/);
  assert.match(cleanup, /statistic\.DefaultManager\.Range/);
  assert.match(cleanup, /connections\[connection\.ID\(\)\] = connection/);
  assert.ok(cleanup.indexOf("androidRuntime.closeTun()") < cleanup.indexOf("statistic.DefaultManager.Range"));
  assert.match(cleanup, /connectionErr := androidRuntime\.closeConnections\(connections\)/);
  assert.match(cleanup, /return errors\.Join\(listenerErr, connectionErr\)/);
  assert.doesNotMatch(cleanup, /if listenerErr/);
  const start = bridge.split("func startTUN(")[1].split("func closeAndroidResources")[0];
  assert.ok(start.indexOf("closeAndroidResources()") < start.indexOf("if fd < 0"));
  assert.match(start, /if err := closeAndroidResources\(\); err != nil \{/);
});

test("Mihomo hook captures its epoch before admission and invalidates it before draining", () => {
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const hook = lifecycle.split("func (l *androidTunLifecycle) socketHook(")[1].split("func (l *androidTunLifecycle) socketHookAtEpoch")[0];
  assert.match(hook, /return l\.socketHookAtEpoch\(l\.epoch\.Load\(\), conn, protect\)/);
  const admission = lifecycle.split("func (l *androidTunLifecycle) socketHookAtEpoch")[1].split("func (l *androidTunLifecycle) blockAndDrain")[0];
  assert.equal((admission.match(/epoch != l\.epoch\.Load\(\)/g) ?? []).length, 2);
  assert.ok(admission.indexOf("epoch != l.epoch.Load()") < admission.indexOf("conn.Control"));
  const drain = lifecycle.split("func (l *androidTunLifecycle) blockAndDrain")[1].split("func (l *androidTunLifecycle) applyConfiguration")[0];
  assert.ok(drain.indexOf("l.protected.Swap(false)") < drain.indexOf("l.epoch.Add(1)"));
  assert.ok(drain.indexOf("l.epoch.Add(1)") < drain.indexOf("l.admission.Lock()"));
});

test("Mihomo serializes upstream parsing, apply, DNS and home mutation through the exported paths", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  assert.match(bridge, /func angelaInit\(homeDir \*C\.char\) \*C\.char \{\s*return resultString\(initializeAndroid\(cString\(homeDir\)\)\)/);
  assert.match(bridge, /func angelaApplyConfig\(configJSON \*C\.char\) \*C\.char \{\s*return resultString\(applyAndroidConfigJSON/);
  assert.match(bridge, /func updateDns\(dns \*C\.char\) \*C\.char \{\s*return resultString\(updateAndroidDNS/);
  const apply = bridge.split("func applyAndroidConfigJSON(")[1].split("//export updateDns")[0];
  assert.ok(apply.indexOf("androidTunMu.Lock()") < apply.indexOf("config.Parse(data)"));
  assert.ok(apply.indexOf("config.Parse(data)") < apply.indexOf("applyAndroidConfiguration(cfg)"));
  assert.ok(apply.indexOf("applyAndroidConfiguration(cfg)") < apply.indexOf("lastConfigJSON ="));
  assert.match(apply, /defer androidTunMu\.Unlock\(\)/);
  const initialize = bridge.split("func initializeAndroid(")[1].split("//export angelaApplyConfig")[0];
  assert.ok(initialize.indexOf("androidTunMu.Lock()") < initialize.indexOf("constant.SetHomeDir(dir)"));
  assert.match(initialize, /defer androidTunMu\.Unlock\(\)/);
  const dns = bridge.split("func updateAndroidDNS(")[1].split("//export startTUN")[0];
  assert.ok(dns.indexOf("androidTunMu.Lock()") < dns.indexOf("config.Parse(updated)"));
  assert.match(dns, /defer androidTunMu\.Unlock\(\)/);
});
