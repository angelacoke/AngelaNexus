import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const PACKAGE = "app.angelanexus";
const ACTIVITY = `${PACKAGE}/.MainActivity`;

export async function runAndroidSmoke({ adb, apk, samples = 30, intervalMs = 1000,
  command = async (args, timeout) => {
    const { stdout } = await execFileAsync(adb, args, { timeout, maxBuffer: 1024 * 1024 });
    return stdout;
  }, sleep = delay } = {}) {
  if (!adb || !apk) throw new Error("ADB and APK are required");
  if (!Number.isInteger(samples) || samples < 2 || samples > 120 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 10_000) {
    throw new Error("Invalid bounded observation window");
  }
  const invoke = (args, timeout = 20_000) => command(args, timeout);
  const installed = await invoke(["install", "-r", apk], 120_000);
  if (!/^Success\s*$/m.test(installed)) throw new Error("APK installation did not report Success");
  await invoke(["shell", "am", "force-stop", PACKAGE]);
  await invoke(["logcat", "-c"]);
  const launched = await invoke(["shell", "am", "start", "-W", "-n", ACTIVITY]);
  if (!/^Status:\s*ok\s*$/m.test(launched) || /(?:Error:|Exception|Permission Denial)/i.test(launched)) {
    throw new Error("Launcher did not report Status: ok");
  }
  let initialPids;
  for (let sample = 0; sample < samples; sample++) {
    await sleep(intervalMs);
    const pids = (await invoke(["shell", "pidof", PACKAGE])).trim().split(/\s+/).sort();
    if (!pids.length || pids.some(pid => !/^\d+$/.test(pid))) {
      throw new Error(`App process missing at observation ${sample + 1}`);
    }
    const identity = pids.join(" ");
    if (initialPids && identity !== initialPids) throw new Error("App process restarted during observation");
    initialPids = identity;
  }
  const activities = await invoke(["shell", "dumpsys", "activity", "activities"]);
  const resumed = activities.split(/\r?\n/).some(line =>
    /(?:mResumedActivity|topResumedActivity|ResumedActivity)\s*[:=]/.test(line) &&
    /app\.angelanexus\/(?:\.MainActivity|app\.angelanexus\.MainActivity)(?:\s|\})/.test(line));
  if (!resumed) throw new Error("MainActivity is not the resumed activity");
  const installedPath = await invoke(["shell", "pm", "path", PACKAGE]);
  if (!/^package:\S+/m.test(installedPath)) throw new Error("Installed package path is missing");
  // Liveness and a resumed Activity do not exclude an ANR. Logcat was cleared
  // immediately before launch, so reject app-scoped failures from this run,
  // including a crash/restart before the first PID observation.
  const logs = await invoke(["logcat", "-d", "-v", "brief"]);
  if (/^[EF]\/AndroidRuntime\s*\([^\n)]*\):\s*Process:\s*app\.angelanexus(?:,|\s*$)/m.test(logs) ||
      /(?:^|\n)[^\n]*\bANR in app\.angelanexus(?:\s|$)/m.test(logs) ||
      />>>\s*app\.angelanexus\s*<<</.test(logs)) {
    throw new Error("App crash or ANR recorded during launcher observation");
  }
  return { package: PACKAGE, pids: initialPids, samples, observationMs: samples * intervalMs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runAndroidSmoke({ adb: process.env.ADB, apk: process.env.APK });
    console.log(`Android runtime smoke test passed: install and launch verified; same process alive for ${result.observationMs} ms; MainActivity resumed.`);
    console.log("Launcher smoke only: no VPN/TUN, proxy traffic, leak or battery validation.");
  } catch (error) {
    console.error(`Android runtime smoke test FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
