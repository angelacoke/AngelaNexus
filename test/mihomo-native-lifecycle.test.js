import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));
const steps = workflow.jobs.build.steps;

test("Mihomo explicit stop owns every provider generation and drains without cancelling attachment config", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const apply = bridge.split("func applyAndroidConfiguration")[1].split("//export angelaInit")[0];
  assert.match(apply, /range cfg\.Providers/);
  assert.match(apply, /range cfg\.RuleProviders/);
  assert.ok(apply.indexOf("androidRuntime.ownProvider") < apply.indexOf("executor.ApplyConfig"));
  assert.match(apply, /androidRuntime\.providersStopped = false/);
  const stop = bridge.split("func stopTunError()")[1].split("//export angelaStopTun")[0];
  assert.match(stop, /context\.WithTimeout\(context\.Background\(\), androidProviderDrainTimeout\)/);
  assert.ok(stop.indexOf("androidRuntime.closeProviders(ctx)") < stop.indexOf("resourceErr := closeAndroidResources()"));
  assert.match(stop, /return errors\.Join\(providerErr, dnsErr, resourceErr\)/);
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.doesNotMatch(cleanup, /closeProviders/);
  const start = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.ok(start.indexOf("if androidRuntime.providersStopped") < start.indexOf("closeAndroidResources()"));
  assert.equal((bridge.match(/return errAndroidProviderCleanupPending/g) ?? []).length, 2);
  assert.match(lifecycle, /WaitClosed\(context\.Context\) error/);
  const close = lifecycle.split("func (l *androidTunLifecycle) closeProviders(")[1];
  assert.ok(close.indexOf("provider.Close()") < close.indexOf("waiter.WaitClosed(ctx)"));
  assert.match(close, /if !failed\[provider\] \{\s*delete\(l\.providers, provider\)/);
});

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
  assert.match(apply, /defer func\(\) \{\s*if !androidRuntime\.ready\(\) \{\s*tunnel\.OnSuspend\(\)/);
  assert.equal((bridge.match(/applyAndroidConfiguration\(cfg\)/g) ?? []).length, 2);
  const stop = bridge.split("func stopTunError")[1].split("//export angelaStopTun")[0];
  assert.ok(stop.indexOf("tunnel.OnSuspend()") < stop.indexOf("closeAndroidResources()"));
  const resume = bridge.split("func suspend(")[1].split("//export forceGC")[0];
  assert.match(resume, /androidTunMu\.Lock\(\)/);
  assert.match(resume, /suspended != 0 \|\| !androidRuntime\.ready\(\)/);
});

test("Mihomo stop and replacement close visible trackers even after listener failure", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const cleanup = bridge.split("func closeAndroidResources()")[1].split("func stopTunError")[0];
  assert.match(cleanup, /listenerErr := androidRuntime\.closeTun\(\)/);
  assert.match(cleanup, /statistic\.DefaultManager\.Range/);
  assert.match(cleanup, /connections\[connection\.ID\(\)\] = connection/);
  assert.ok(cleanup.indexOf("androidRuntime.closeTun()") < cleanup.indexOf("statistic.DefaultManager.Range"));
  assert.match(cleanup, /connectionErr := androidRuntime\.closeConnections\(connections\)/);
  assert.match(cleanup, /return errors\.Join\(listenerErr, connectionErr, setupErr, lateErr\)/);
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

test("Mihomo stop announces admission closure before waiting for serialized control work", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const stop = bridge.split("func stopTunError()")[1].split("//export angelaStopTun")[0];
  assert.ok(stop.indexOf("androidRuntime.beginStop()") < stop.indexOf("androidTunMu.Lock()"));
  assert.match(stop, /defer androidRuntime\.endStop\(\)/);
  const start = bridge.split("func startTUN(")[1].split("func closeAndroidResources")[0];
  assert.ok(start.indexOf("androidRuntime.pendingStops.Load() != 0") < start.indexOf("unix.FcntlInt"));
  assert.match(start, /androidRuntime\.restoreAdmission\(true\)/);
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const restore = lifecycle.split("func (l *androidTunLifecycle) restoreAdmission")[1].split("func (l *androidTunLifecycle) blockAndDrain")[0];
  assert.ok(restore.indexOf("l.admission.Lock()") < restore.indexOf("l.pendingStops.Load()"));
  assert.match(restore, /defer l\.admission\.Unlock\(\)/);
});

test("Mihomo suspension state is wired before tunnel transitions and readiness", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const suspend = bridge.split("func suspend(")[1].split("//export forceGC")[0];
  assert.match(suspend, /androidTunMu\.Lock\(\)/);
  assert.match(suspend, /defer androidTunMu\.Unlock\(\)/);
  assert.match(suspend, /androidRuntime\.setSuspended\(suspended != 0\)/);
  const lock = suspend.indexOf("androidTunMu.Lock()");
  const setSuspended = suspend.indexOf("androidRuntime.setSuspended(suspended != 0)");
  assert.ok(lock < setSuspended);
  assert.ok(setSuspended < suspend.indexOf("tunnel.OnSuspend()"));
  assert.ok(setSuspended < suspend.indexOf("tunnel.OnRunning()"));

  const start = bridge.split("func startTUN(")[1].split("func closeAndroidResources")[0];
  const listener = start.indexOf("androidRuntime.listener = listener");
  assert.ok(listener >= 0);
  assert.ok(listener < start.indexOf("androidRuntime.setSuspended(false)"));
  assert.ok(start.indexOf("androidRuntime.setSuspended(false)") < start.indexOf("androidRuntime.restoreAdmission(true)"));

  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const ready = lifecycle.split("func (l *androidTunLifecycle) ready()")[1].split("func (l *androidTunLifecycle) beginStop")[0];
  assert.match(ready, /!l\.suspended\.Load\(\)/);
});

test("Mihomo pause gates hooks before waiting for serialized control work", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const pause = bridge.split("func suspend(")[1].split("//export forceGC")[0];
  assert.match(pause, /if suspended != 0 \{[\s\S]*androidRuntime\.beginSuspend\(\)/);
  assert.ok(pause.indexOf("androidRuntime.beginSuspend()") < pause.indexOf("androidTunMu.Lock()"));
  assert.match(pause, /defer androidRuntime\.endSuspend\(\)/);
  // Defers run in reverse order: retire the request before releasing control.
  assert.ok(pause.indexOf("defer androidTunMu.Unlock()") < pause.indexOf("defer androidRuntime.endSuspend()"));
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const ready = lifecycle.split("func (l *androidTunLifecycle) ready()")[1].split("func (l *androidTunLifecycle) beginSuspend")[0];
  assert.match(ready, /l\.pendingSuspends\.Load\(\) == 0/);
  const begin = lifecycle.split("func (l *androidTunLifecycle) beginSuspend()")[1].split("func (l *androidTunLifecycle) endSuspend")[0];
  assert.ok(begin.indexOf("l.pendingSuspends.Add(1)") < begin.indexOf("l.setSuspended(true)"));
});

test("Mihomo queued config and DNS retain their request's stop generation across the control wait", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  for (const [name, end] of [["applyAndroidConfigJSON", "//export updateDns"], ["updateAndroidDNS", "//export startTUN"]]) {
    const body = bridge.split(`func ${name}(`)[1].split(end)[0];
    assert.ok(body.indexOf("generation := androidRuntime.stopGeneration.Load()") < body.indexOf("androidTunMu.Lock()"));
    assert.match(body, new RegExp(`return ${name}AtGeneration\\([^\\n]*generation\\)`));
    const checks = [...body.matchAll(/androidRuntime\.checkConfigurationGeneration\(generation\)/g)].map(match => match.index);
    assert.equal(checks.length, 2);
    const lock = body.indexOf("androidTunMu.Lock()");
    assert.ok(checks[0] < lock && checks[1] > lock);
    assert.ok(checks[1] < body.indexOf("config.Parse("));
  }
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const begin = lifecycle.split("func (l *androidTunLifecycle) beginStop()")[1].split("func (l *androidTunLifecycle) endStop()")[0];
  assert.ok(begin.indexOf("l.pendingStops.Add(1)") < begin.indexOf("l.stopGeneration.Add(1)"));
  assert.ok(begin.indexOf("l.stopGeneration.Add(1)") < begin.indexOf("l.blockAndDrain()"));
  const check = lifecycle.split("func (l *androidTunLifecycle) checkConfigurationGeneration")[1].split("// Serialize restoration")[0];
  assert.match(check, /l\.pendingStops\.Load\(\) != 0 \|\| generation != l\.stopGeneration\.Load\(\)/);
});

test("Mihomo foreign-thread smoke only allows the exact stop rejection during concurrent updates", () => {
  const smoke = read("scripts/smoke-mihomo-library.py");
  const lifecycle = read("native/android/mihomo-bridge/lifecycle.go");
  const message = "Android configuration request rejected by stop; retry after stop completes";
  assert.ok(lifecycle.includes(message) && smoke.includes(`error == "${message}"`));
  assert.match(smoke, /allow_stopped=False/);
  assert.match(smoke, /allow_stopped and name in \("angelaApplyConfig", "updateDns"\)/);
  assert.equal((smoke.match(/allow_stopped=True/g) ?? []).length, 2);
  const concurrent = smoke.split("def concurrent_calls(worker):")[1].split("with ThreadPoolExecutor")[0];
  assert.equal((concurrent.match(/allow_stopped=True/g) ?? []).length, 2);
  assert.match(concurrent, /library\.startTUN\(-1, b"system", b"", b""\) != 0/);
  assert.match(smoke, /ThreadPoolExecutor\(max_workers=6\)/);
  const after = smoke.split("list(workers.map(concurrent_calls, range(6)))")[1];
  assert.match(after, /call\("angelaApplyConfig", config\)/);
  assert.match(after, /call\("updateDns", b"127\.0\.0\.1"\)/);
  assert.doesNotMatch(after, /allow_stopped=True/);
});

test("Mihomo TUN start retains its stop generation and rejects before touching newer ownership", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const start = bridge.split("func startTUN(")[1].split("func startAndroidTUNAtGeneration(")[0];
  assert.ok(start.indexOf("generation := androidRuntime.stopGeneration.Load()") < start.indexOf("startAndroidTUNAtGeneration("));
  assert.ok(start.indexOf("androidRuntime.checkConfigurationGeneration(generation)") < start.indexOf("cString(stack)"));
  assert.match(start, /startAndroidTUNAtGeneration\(int\(fd\), cString\(stack\), cString\(address\), cString\(dns\), generation\)/);
  const body = bridge.split("func startAndroidTUNAtGeneration(")[1].split("func closeAndroidResources()")[0];
  const lock = body.indexOf("androidTunMu.Lock()");
  const check = body.indexOf("androidRuntime.checkConfigurationGeneration(generation)");
  assert.ok(lock >= 0 && check > lock);
  for (const mutation of ["tunnel.OnSuspend()", "closeAndroidResources()", "unix.FcntlInt(uintptr(fd), unix.F_DUPFD_CLOEXEC, 3)", "syscall.Close(fd)", "androidRuntime.listener = listener"]) {
    assert.ok(check < body.indexOf(mutation), mutation);
  }
  assert.match(body, /defer androidTunMu\.Unlock\(\)/);
});

test("Mihomo rechecks stop after construction before consuming the caller descriptor", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const wrapper = bridge.split("func startAndroidTUNAtGeneration(")[1].split("func startAndroidTUNWithConstructor(")[0];
  assert.match(wrapper, /return startAndroidTUNWithConstructor\(/);
  assert.match(wrapper, /return sing_tun\.NewWithOwnedFD\(options, tunnel\.Tunnel\)/);
  const body = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.doesNotMatch(body, /(?:syscall|unix)\.Close\(dupFd\)/);
  const constructed = body.indexOf("listener, err := construct(options)");
  const retained = body.indexOf("androidRuntime.listener = listener", constructed);
  const recheck = body.indexOf("androidRuntime.checkConfigurationGeneration(generation)", retained);
  const callerClose = body.indexOf("syscall.Close(fd)");
  assert.ok(constructed >= 0 && retained > constructed && recheck > retained && callerClose > recheck);
  assert.match(body.slice(recheck, callerClose), /_ = closeAndroidResources\(\)\s*return false/);
  assert.ok(callerClose < body.indexOf("androidRuntime.setSuspended(false)"));
  assert.ok(callerClose < body.indexOf("androidRuntime.restoreAdmission(true)"));
  const checks = [...body.matchAll(/androidRuntime\.checkConfigurationGeneration\(generation\)/g)].map(match => match.index);
  assert.equal(checks.length, 3);
  assert.ok(checks[1] < body.indexOf("unix.FcntlInt("));
});

test("Mihomo TUN duplicates avoid standard descriptors and atomically prevent exec inheritance", () => {
  const bridge = read("native/android/mihomo-bridge/bridge.go");
  const body = bridge.split("func startAndroidTUNWithConstructor(")[1].split("func closeAndroidResources()")[0];
  assert.match(body, /dupFd, err := unix\.FcntlInt\(uintptr\(fd\), unix\.F_DUPFD_CLOEXEC, 3\)/);
  assert.match(body, /FileDescriptor:\s+dupFd/);
  assert.doesNotMatch(body, /syscall\.Dup\(|unix\.Dup\(|CloseOnExec\(/);
  const regression = read("native/android/mihomo-bridge/bridge_integration_test.go");
  assert.match(regression, /func TestAndroidBridgeConstructionWithClosedStdin\(/);
  assert.match(regression, /syscall\.Close\(0\)/);
  assert.match(regression, /listener\.fd >= 3/);
  assert.match(regression, /flags&syscall\.FD_CLOEXEC != 0/);
});
