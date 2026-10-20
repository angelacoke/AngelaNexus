import test from "node:test";
import assert from "node:assert/strict";
import { runAndroidSmoke } from "../scripts/android-runtime-smoke.mjs";

function fixture(overrides = {}) {
  const calls = [];
  let sleeps = 0;
  const responses = {
    install: "Success\r\n",
    "shell am start": "Starting: Intent { cmp=app.angelanexus/.MainActivity }\nStatus: ok\nComplete\n",
    "shell pidof": "4123\r\n",
    "shell dumpsys": "  topResumedActivity=ActivityRecord{abc u0 app.angelanexus/.MainActivity t1}\n",
    "shell pm path": "package:/data/app/app.angelanexus/base.apk\n",
    ...overrides,
  };
  return {
    calls,
    get sleeps() { return sleeps; },
    options: {
      adb: "/fixture/adb", apk: "/fixture/app.apk", samples: 3, intervalMs: 1,
      sleep: async () => { sleeps++; },
      command: async (args, timeout) => {
        calls.push({ args, timeout });
        const key = Object.keys(responses).find(key => args.join(" ").startsWith(key));
        const value = responses[key] ?? "";
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value() : value;
      },
    },
  };
}

test("Android smoke verifies install, launch, sustained identity and resumed activity", async () => {
  const f = fixture();
  const result = await runAndroidSmoke(f.options);
  assert.equal(result.pids, "4123");
  assert.equal(result.samples, 3);
  assert.equal(f.sleeps, 3);
  assert.equal(f.calls[0].timeout, 120_000);
  assert.ok(f.calls.slice(1).every(call => call.timeout === 20_000));
  assert.deepEqual(f.calls[1].args, ["shell", "am", "force-stop", "app.angelanexus"]);
});

for (const [name, overrides, error] of [
  ["install command failure", { install: new Error("INSTALL_FAILED") }, /INSTALL_FAILED/],
  ["install failure despite zero adb exit", { install: "Failure [INSTALL_FAILED_INVALID_APK]" }, /installation/],
  ["launch failure despite zero adb exit", { "shell am start": "Error: Activity class does not exist" }, /Launcher/],
  ["permission denial alongside ok status", { "shell am start": "Status: ok\nPermission Denial" }, /Launcher/],
  ["missing process", { "shell pidof": "" }, /process missing/],
  ["adb timeout", { "shell pidof": new Error("adb timeout") }, /adb timeout/],
  ["non-numeric pid", { "shell pidof": "error: device offline" }, /process missing/],
  ["background-only activity", { "shell dumpsys": "ActivityRecord{abc app.angelanexus/.MainActivity t1}\nmResumedActivity: other/.Activity" }, /not the resumed/],
  ["lookalike resumed activity", { "shell dumpsys": "mResumedActivity: app.angelanexus/.MainActivityFake t1" }, /not the resumed/],
  ["missing installed path", { "shell pm path": "" }, /package path/],
]) {
  test(`Android smoke fails closed on ${name}`, async () => {
    const f = fixture(overrides);
    await assert.rejects(runAndroidSmoke(f.options), error);
    if (name.startsWith("install")) assert.equal(f.calls.length, 1);
  });
}

test("Android smoke catches delayed crash instead of accepting initial liveness", async () => {
  let observations = 0;
  const f = fixture({ "shell pidof": () => ++observations === 1 ? "4123" : "" });
  await assert.rejects(runAndroidSmoke(f.options), /process missing at observation 2/);
});

test("Android smoke rejects a process that crashes and restarts", async () => {
  let observations = 0;
  const f = fixture({ "shell pidof": () => ++observations === 1 ? "4123" : "4124" });
  await assert.rejects(runAndroidSmoke(f.options), /restarted/);
});

test("Android smoke accepts the fully qualified resumed activity spelling", async () => {
  const f = fixture({ "shell dumpsys": "mResumedActivity: ActivityRecord{a u0 app.angelanexus/app.angelanexus.MainActivity t1}" });
  await runAndroidSmoke(f.options);
});

test("Android smoke validates required inputs and bounded observation options before commands", async () => {
  const f = fixture();
  for (const options of [{ adb: "" }, { apk: "" }, { samples: 0 }, { samples: 121 }, { intervalMs: 0 }, { intervalMs: Infinity }]) {
    await assert.rejects(runAndroidSmoke({ ...f.options, ...options }), /required|bounded/);
  }
  assert.equal(f.calls.length, 0);
});

for (const [name, log] of [
  ["Java crash before first PID sample", "E/AndroidRuntime( 4100): FATAL EXCEPTION: main\nE/AndroidRuntime( 4100): Process: app.angelanexus, PID: 4100\n"],
  ["ANR while PID stays alive and activity remains resumed", "E/ActivityManager( 100): ANR in app.angelanexus (app.angelanexus/.MainActivity)\n"],
  ["native crash before first PID sample", "F/DEBUG   ( 4100): pid: 4100, tid: 4100, name: main  >>> app.angelanexus <<<\n"],
]) {
  test(`Android smoke rejects ${name}`, async () => {
    const f = fixture({ "logcat -d": log });
    await assert.rejects(runAndroidSmoke(f.options), /crash or ANR/);
    assert.equal(f.sleeps, 3);
  });
}

test("Android smoke does not attribute another app's crash or ANR to the launcher", async () => {
  const f = fixture({ "logcat -d": [
    "E/AndroidRuntime( 50): Process: app.angelanexus.other, PID: 50",
    "E/ActivityManager( 100): ANR in app.angelanexus.other (app.angelanexus.other/.MainActivity)",
    "F/DEBUG ( 50): >>> app.angelanexus.other <<<",
  ].join("\n") });
  await runAndroidSmoke(f.options);
});

test("Android smoke fails closed when post-launch failure logs cannot be read", async () => {
  const f = fixture({ "logcat -d": new Error("logcat device disconnected") });
  await assert.rejects(runAndroidSmoke(f.options), /device disconnected/);
});
