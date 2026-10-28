import test from "node:test";
import assert from "node:assert/strict";
import { waitForAndroidSystemServices } from "../scripts/wait-for-android-system-services.mjs";

const READY_OUTPUTS = {
  "get-state": "device\n",
  "shell getprop sys.boot_completed": "1\n",
  "shell service check settings": "Service settings: found\n",
  "shell settings get system screen_off_timeout": "600000\n",
  "shell service check package": "Service package: found\n",
  "shell pm path android": "package:/system/framework/framework-res.apk\n",
  "shell service check activity": "Service activity: found\n",
  "shell am get-current-user": "0\n",
};

const SETTINGS_WRITES = [
  "shell settings put global window_animation_scale 0",
  "shell settings put global transition_animation_scale 0",
  "shell settings put global animator_duration_scale 0",
];

function sequence(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function fixture(overrides = {}, options = {}) {
  const calls = [];
  let elapsedMs = 0;
  const command = async (args, timeout) => {
    const key = args.join(" ");
    calls.push({ key, timeout });
    const override = overrides[key];
    if (override instanceof Error) throw override;
    if (typeof override === "function") {
      const result = override();
      if (result instanceof Error) throw result;
      return result;
    }
    if (override !== undefined) return override;
    if (Object.hasOwn(READY_OUTPUTS, key)) return READY_OUTPUTS[key];
    if (SETTINGS_WRITES.includes(key)) return "";
    throw new Error(`Unexpected ADB command: ${key}`);
  };
  return {
    calls,
    options: {
      adb: "/fixture/adb",
      timeoutMs: 100,
      intervalMs: 1,
      stableSamples: 3,
      command,
      sleep: async ms => { elapsedMs += ms; },
      now: () => elapsedMs,
      logger: () => {},
      ...options,
    },
  };
}

const lastProbeIndex = calls => Math.max(...calls
  .map((call, index) => call.key === "shell am get-current-user" ? index : -1));

test("readiness waits for boot and stable settings/package/activity services before configuring animations", async () => {
  const f = fixture({
    "shell getprop sys.boot_completed": sequence(["0\n", "1\n", "1\n", "1\n"]),
    "shell service check settings": sequence([
      "Service settings: not found\n",
      "Service settings: found\n",
      "Service settings: found\n",
      "Service settings: found\n",
      "Service settings: found\n",
      "Service settings: found\n",
    ]),
  });

  const result = await waitForAndroidSystemServices(f.options);
  assert.equal(result.stableSamples, 3);
  assert.ok(f.calls.filter(call => call.key === "shell service check settings").length >= 4);
  assert.equal(f.calls.filter(call => SETTINGS_WRITES.includes(call.key)).length, 3);
  assert.ok(f.calls.findIndex(call => SETTINGS_WRITES.includes(call.key)) > lastProbeIndex(f.calls));
});

test("readiness accepts an unset settings value and CRLF service responses", async () => {
  const f = fixture({
    "shell service check settings": "Service settings: found\r\n",
    "shell settings get system screen_off_timeout": "null\r\n",
    "shell service check package": "Service package: found\r\n",
    "shell pm path android": "package:/system/framework/framework-res.apk\r\n",
    "shell service check activity": "Service activity: found\r\n",
    "shell am get-current-user": "0\r\n",
  });

  const result = await waitForAndroidSystemServices(f.options);
  assert.equal(result.stableSamples, 3);
  assert.equal(f.calls.filter(call => SETTINGS_WRITES.includes(call.key)).length, 3);
});

test("transient settings-service write failure resets the stability window and retries", async () => {
  let attempts = 0;
  const f = fixture({
    [SETTINGS_WRITES[0]]: () => {
      attempts += 1;
      if (attempts === 1) return new Error("Failure calling service settings: Broken pipe (32)");
      return "";
    },
  });

  const result = await waitForAndroidSystemServices(f.options);
  assert.equal(result.stableSamples, 3);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter(call => call.key === "shell service check settings").length, 6);
  assert.equal(f.calls.filter(call => SETTINGS_WRITES.includes(call.key)).length, 4);
});

test("readiness fails closed without changing settings when a required service never appears", async () => {
  const f = fixture({
    "shell service check settings": "Service settings: not found\n",
  }, { timeoutMs: 9, intervalMs: 2 });

  await assert.rejects(waitForAndroidSystemServices(f.options), /settings service was not ready/i);
  assert.equal(f.calls.filter(call => SETTINGS_WRITES.includes(call.key)).length, 0);
});

test("readiness rejects invalid bounds before invoking ADB", async () => {
  const f = fixture();
  for (const options of [
    { timeoutMs: 0 }, { timeoutMs: 900_001 }, { intervalMs: 0 },
    { stableSamples: 1 }, { stableSamples: 11 }, { adb: "" },
  ]) {
    await assert.rejects(waitForAndroidSystemServices({ ...f.options, ...options }), /required|bounded/);
  }
  assert.equal(f.calls.length, 0);
});
