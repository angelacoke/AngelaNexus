import test from "node:test";
import assert from "node:assert/strict";
import { runAndroidSmoke } from "../scripts/android-runtime-smoke.mjs";

function fixture(overrides = {}) {
  const calls = [];
  let sleeps = 0;
  let elapsedMs = 0;
  const responses = {
    install: "Success\r\n",
    "shell am start": { stdout: "Starting: Intent { cmp=app.angelanexus/.MainActivity }\n", stderr: "" },
    "shell pidof": "4123\r\n",
    "shell dumpsys": "  topResumedActivity=ActivityRecord{abc u0 app.angelanexus/.MainActivity t1}\n",
    "shell pm path": "package:/data/app/app.angelanexus/base.apk\n",
    ...overrides,
  };
  return {
    calls,
    get sleeps() { return sleeps; },
    get elapsedMs() { return elapsedMs; },
    advance: ms => { elapsedMs += ms; },
    options: {
      adb: "/fixture/adb", apk: "/fixture/app.apk", samples: 3, intervalMs: 1,
      sleep: async ms => { sleeps++; elapsedMs += ms; },
      now: () => elapsedMs,
      command: async (args, timeout) => {
        calls.push({ args, timeout });
        const key = Object.keys(responses).find(key => args.join(" ").startsWith(key));
        const value = responses[key] ?? "";
        const result = typeof value === "function" ? value(args) : value;
        if (result instanceof Error) throw result;
        return typeof result === "string" ? { stdout: result, stderr: "" } : result;
      },
    },
  };
}

const launchCall = f => f.calls.find(call => call.args[2] === "start");

test("Android smoke confirms launch from a live PID and resumed Activity, not am start status", async () => {
  const launchStdout = "Starting: Intent { cmp=app.angelanexus/.MainActivity }\nStatus: timeout\n";
  const launchStderr = "ActivityManager wait expired; checking actual foreground state\n";
  const f = fixture({ "shell am start": { stdout: launchStdout, stderr: launchStderr } });
  const result = await runAndroidSmoke(f.options);
  assert.equal(result.pids, "4123");
  assert.equal(result.samples, 3);
  assert.equal(result.observationMs, 3);
  assert.equal(result.launcher.stdout, launchStdout);
  assert.equal(result.launcher.stderr, launchStderr);
  assert.equal(f.sleeps, 3);
  assert.equal(f.calls[0].timeout, 360_000);
  const start = launchCall(f);
  assert.deepEqual(start.args, ["shell", "am", "start", "-n", "app.angelanexus/.MainActivity"]);
  assert.equal(start.timeout, 20_000);
  assert.deepEqual(f.calls[4].args, ["shell", "pidof", "app.angelanexus"]);
  assert.deepEqual(f.calls[5].args, ["shell", "dumpsys", "activity", "activities"]);
  assert.ok(f.calls.filter(call => call !== f.calls[0]).every(call => call.timeout === 20_000));
  assert.deepEqual(f.calls[1].args, ["shell", "am", "force-stop", "app.angelanexus"]);
});

test("Android smoke waits for delayed process and actual resumed MainActivity", async () => {
  let pidChecks = 0;
  let activityChecks = 0;
  const f = fixture({
    "shell am start": { stdout: "Status: timeout\n", stderr: "" },
    "shell pidof": () => ++pidChecks === 1 ? "" : "4123",
    "shell dumpsys": () => ++activityChecks === 1
      ? "mResumedActivity: other/.HomeActivity t1\n"
      : "topResumedActivity=ActivityRecord{abc u0 app.angelanexus/.MainActivity t1}\n",
  });
  const result = await runAndroidSmoke(f.options);
  assert.equal(result.pids, "4123");
  assert.equal(pidChecks, 6); // 3 launch polls, then 3 stability samples.
  assert.equal(activityChecks, 3); // 2 launch polls, then final resumed check.
  assert.equal(f.elapsedMs, 2_003);
  assert.equal(f.sleeps, 5);
});

test("Android smoke retries pidof exit code 1 with empty output during startup", async () => {
  let pidChecks = 0;
  const noProcess = Object.assign(new Error("Command failed with exit code 1"), {
    code: 1, stdout: "", stderr: "",
  });
  const f = fixture({ "shell pidof": () => ++pidChecks === 1 ? noProcess : "4123" });
  const result = await runAndroidSmoke(f.options);
  assert.equal(result.pids, "4123");
  assert.equal(pidChecks, 5); // one startup miss, one startup success, three stability samples.
  assert.equal(f.elapsedMs, 1_003);
});

test("Android smoke fails closed at 60 seconds when am start says timeout and no app process appears", async () => {
  const f = fixture({
    "shell am start": { stdout: "Status: timeout\n", stderr: "wait expired\n" },
    "shell pidof": "",
  });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.match(error.message, /Timed out after 60000ms/);
    assert.match(error.message, /last pidof stdout=\"\"/);
    assert.ok(error.message.includes("Status: timeout"));
    assert.ok(error.message.includes("wait expired"));
    return true;
  });
  assert.equal(f.elapsedMs, 60_000);
  const polls = f.calls.filter(call => call.args[0] === "shell" && call.args[1] === "pidof");
  assert.equal(polls.length, 60);
  assert.ok(polls.every(call => call.timeout > 0 && call.timeout <= 20_000));
  assert.equal(polls.at(-1).timeout, 1_000);
});

test("Android smoke does not accept Status ok and a live PID without the actual foreground MainActivity", async () => {
  const f = fixture({
    "shell am start": { stdout: "Status: ok\n", stderr: "" },
    "shell pidof": "4123",
    "shell dumpsys": "mResumedActivity: other/.HomeActivity t1\n",
  });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.match(error.message, /Timed out after 60000ms.*foreground/);
    assert.ok(error.message.includes("other/.HomeActivity"));
    return true;
  });
  assert.equal(f.elapsedMs, 60_000);
});

test("Android smoke does not accept mResumedActivity when topResumedActivity names another app", async () => {
  const f = fixture({
    "shell dumpsys": [
      "mResumedActivity: ActivityRecord{abc u0 app.angelanexus/.MainActivity t1}",
      "topResumedActivity=ActivityRecord{def u0 other/.HomeActivity t2}",
    ].join("\n"),
  });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.match(error.message, /Timed out after 60000ms/);
    assert.ok(error.message.includes("topResumedActivity=ActivityRecord{def u0 other/.HomeActivity t2}"));
    return true;
  });
});

test("Android smoke rejects PID and resumed-Activity results arriving after the 60s deadline", async t => {
  await t.test("PID arriving after deadline", async () => {
    let f;
    f = fixture({ "shell pidof": () => { f.advance(60_001); return "4123"; } });
    await assert.rejects(runAndroidSmoke(f.options), /Timed out after 60000ms/);
    assert.equal(f.calls.filter(call => call.args[0] === "shell" && call.args[1] === "dumpsys").length, 0);
  });
  await t.test("resumed Activity arriving after deadline", async () => {
    let f;
    f = fixture({ "shell dumpsys": () => {
      f.advance(60_001);
      return "topResumedActivity=ActivityRecord{abc u0 app.angelanexus/.MainActivity t1}";
    } });
    await assert.rejects(runAndroidSmoke(f.options), /Timed out after 60000ms/);
  });
});

test("Android smoke preserves stdout and stderr when the non-waiting launch command fails", async () => {
  const failure = Object.assign(new Error("exit code 1"), {
    stdout: "shell stdout",
    stderr: "Permission Denial from ActivityTaskManager",
  });
  const f = fixture({ "shell am start": failure });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.match(error.message, /adb shell am start failed: exit code 1/);
    assert.ok(error.message.includes('stdout="shell stdout"'));
    assert.ok(error.message.includes('stderr="Permission Denial from ActivityTaskManager"'));
    return true;
  });
});

test("Android smoke preserves install stdout and stderr when adb exits successfully with an install failure", async () => {
  const f = fixture({ install: {
    stdout: "Failure [INSTALL_FAILED_INVALID_APK]\n",
    stderr: "native package rejected APK\n",
  } });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.ok(error.message.includes("APK installation did not report Success"));
    assert.ok(error.message.includes("INSTALL_FAILED_INVALID_APK"));
    assert.ok(error.message.includes("native package rejected APK"));
    return true;
  });
  assert.equal(f.calls.length, 1);
});

for (const [name, overrides, error] of [
  ["install command failure", { install: new Error("INSTALL_FAILED") }, /INSTALL_FAILED/],
  ["install failure despite zero adb exit", { install: "Failure [INSTALL_FAILED_INVALID_APK]" }, /installation/],
  ["launch failure despite zero adb exit", { "shell am start": "Error: Activity class does not exist" }, /Launcher start command reported an error/],
  ["permission denial alongside ok status", { "shell am start": "Status: ok\nPermission Denial" }, /Launcher start command reported an error/],
  ["missing process", { "shell pidof": "" }, /Timed out after 60000ms/],
  ["adb timeout", { "shell pidof": new Error("adb timeout") }, /adb timeout/],
  ["pidof exit code 1 with diagnostics", { "shell pidof": Object.assign(new Error("exit code 1"), { code: 1, stdout: "", stderr: "device offline" }) }, /device offline/],
  ["zero pid", { "shell pidof": "0" }, /last pidof stdout/],
  ["non-numeric pid", { "shell pidof": "error: device offline" }, /last pidof stdout/],
  ["background-only activity", { "shell dumpsys": "ActivityRecord{abc app.angelanexus/.MainActivity t1}\nmResumedActivity: other/.Activity" }, /other\/.Activity/],
  ["lookalike resumed activity", { "shell dumpsys": "mResumedActivity: app.angelanexus/.MainActivityFake t1" }, /MainActivityFake/],
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
  const f = fixture({ "shell pidof": () => ++observations <= 2 ? "4123" : "" });
  await assert.rejects(runAndroidSmoke(f.options), /process missing at observation 2/);
});

test("Android smoke rejects a process that crashes and restarts", async () => {
  let observations = 0;
  const f = fixture({ "shell pidof": () => ++observations <= 2 ? "4123" : "4124" });
  await assert.rejects(runAndroidSmoke(f.options), /restarted/);
});

test("Android smoke rejects PID zero during the stability window", async () => {
  let observations = 0;
  const f = fixture({ "shell pidof": () => ++observations === 1 ? "4123" : "0" });
  await assert.rejects(runAndroidSmoke(f.options), /process missing at observation 1/);
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

test("Android smoke reads relevant failure tags from all required buffers without truncation", async () => {
  const f = fixture();
  await runAndroidSmoke(f.options);
  const logs = f.calls.find(call => call.args[0] === "logcat" && call.args[1] === "-d");
  assert.deepEqual(logs.args, ["logcat", "-d", "-v", "brief",
    "-b", "main", "-b", "system", "-b", "crash",
    "AndroidRuntime:E", "ActivityManager:E", "ActivityTaskManager:E", "DEBUG:F", "*:S"]);
  assert.equal(logs.timeout, 20_000);
});

test("Android smoke preserves filtered-log overflow failure with command context", async () => {
  const failure = new Error("stdout maxBuffer length exceeded");
  const f = fixture({ "logcat -d": failure });
  await assert.rejects(runAndroidSmoke(f.options), error => {
    assert.match(error.message, /adb logcat -d -v failed: stdout maxBuffer/);
    assert.equal(error.cause, failure);
    return true;
  });
});
