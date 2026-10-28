import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 20_000;
const INSTALL_TIMEOUT_MS = 360_000;
const LAUNCH_CONFIRMATION_TIMEOUT_MS = 60_000;
const LAUNCH_POLL_INTERVAL_MS = 1_000;
const PACKAGE = "app.angelanexus";
const ACTIVITY = `${PACKAGE}/.MainActivity`;

function resumedActivityLine(output) {
  const lines = output.split(/\r?\n/);
  return lines.find(line => /topResumedActivity\s*[:=]/.test(line)) ??
    lines.find(line => /(?:mResumedActivity|ResumedActivity)\s*[:=]/.test(line));
}

function isMainActivityResumed(output) {
  const line = resumedActivityLine(output);
  return Boolean(line && /app\.angelanexus\/(?:\.MainActivity|app\.angelanexus\.MainActivity)(?:\s|\})/.test(line));
}

function describeResumedActivity(output) {
  return resumedActivityLine(output)?.trim() || "(no resumed Activity entry)";
}

function validProcessIds(output) {
  const pids = output.trim().split(/\s+/).filter(Boolean).sort();
  return pids.length > 0 && pids.every(pid => /^\d+$/.test(pid) && BigInt(pid) > 0n) ? pids : null;
}

function normalizeCommandResult(result) {
  if (typeof result === "string") return { stdout: result, stderr: "" };
  if (result && typeof result.stdout === "string") {
    return { stdout: result.stdout, stderr: typeof result.stderr === "string" ? result.stderr : "" };
  }
  throw new Error("ADB command returned no stdout");
}

function errorStreamDetails(error) {
  const details = [];
  if (typeof error?.stdout === "string") details.push(`stdout=${JSON.stringify(error.stdout)}`);
  if (typeof error?.stderr === "string") details.push(`stderr=${JSON.stringify(error.stderr)}`);
  return details.length ? `; ${details.join("; ")}` : "";
}

export async function runAndroidSmoke({ adb, apk, samples = 30, intervalMs = 1000,
  command = async (args, timeout) => execFileAsync(adb, args, { timeout, maxBuffer: 1024 * 1024 }),
  sleep = delay, now = () => performance.now() } = {}) {
  if (!adb || !apk) throw new Error("ADB and APK are required");
  if (!Number.isInteger(samples) || samples < 2 || samples > 120 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 10_000) {
    throw new Error("Invalid bounded observation window");
  }
  const invoke = async (args, timeout = COMMAND_TIMEOUT_MS, { allowEmptyExitCode } = {}) => {
    try {
      return normalizeCommandResult(await command(args, timeout));
    } catch (error) {
      if (error?.code === allowEmptyExitCode && allowEmptyExitCode !== undefined &&
          typeof error.stdout === "string" && !error.stdout.trim() &&
          typeof error.stderr === "string" && !error.stderr.trim()) {
        return { stdout: "", stderr: "" };
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`adb ${args.slice(0, 3).join(" ")} failed: ${message}${errorStreamDetails(error)}`, { cause: error });
    }
  };

  const installed = await invoke(["install", "-r", apk], INSTALL_TIMEOUT_MS);
  if (!/^Success\s*$/m.test(installed.stdout)) {
    throw new Error(`APK installation did not report Success (stdout=${JSON.stringify(installed.stdout)}; stderr=${JSON.stringify(installed.stderr)})`);
  }
  await invoke(["shell", "am", "force-stop", PACKAGE]);
  await invoke(["logcat", "-c"]);

  // Start without ActivityManager's internal -W wait, which can expire before
  // a slow software emulator actually renders the Activity. Success is based
  // only on observing both the app process and its actual resumed Activity.
  const launched = await invoke(["shell", "am", "start", "-n", ACTIVITY]);
  const launchOutput = `${launched.stdout}\n${launched.stderr}`;
  if (/(?:Error:|Exception|Permission Denial)/i.test(launchOutput)) {
    throw new Error(`Launcher start command reported an error (stdout=${JSON.stringify(launched.stdout)}; stderr=${JSON.stringify(launched.stderr)})`);
  }

  const launchDeadline = now() + LAUNCH_CONFIRMATION_TIMEOUT_MS;
  let launchPids = "";
  let lastPidOutput = "(not checked)";
  let lastResumedActivity = "(not checked)";
  while (now() < launchDeadline) {
    const pidTimeout = Math.min(COMMAND_TIMEOUT_MS, launchDeadline - now());
    if (pidTimeout <= 0) break;
    // Android pidof exits with code 1 and no output while the app process is
    // not present yet. During startup, treat only that exact result as a poll
    // miss; transport errors and diagnostics still fail immediately.
    const pidResult = await invoke(["shell", "pidof", PACKAGE], pidTimeout, { allowEmptyExitCode: 1 });
    lastPidOutput = pidResult.stdout;
    if (now() >= launchDeadline) break;

    const pids = validProcessIds(pidResult.stdout);
    if (pids) {
      const activityTimeout = Math.min(COMMAND_TIMEOUT_MS, launchDeadline - now());
      if (activityTimeout <= 0) break;
      const activityResult = await invoke(["shell", "dumpsys", "activity", "activities"], activityTimeout);
      lastResumedActivity = describeResumedActivity(activityResult.stdout);
      if (now() >= launchDeadline) break;
      if (isMainActivityResumed(activityResult.stdout)) {
        launchPids = pids.join(" ");
        break;
      }
    } else {
      lastResumedActivity = "(not checked: no valid app PID yet)";
    }

    const remainingMs = launchDeadline - now();
    if (remainingMs > 0) await sleep(Math.min(LAUNCH_POLL_INTERVAL_MS, remainingMs));
  }
  if (!launchPids) {
    throw new Error(`Timed out after ${LAUNCH_CONFIRMATION_TIMEOUT_MS}ms waiting for ${ACTIVITY} in the foreground with a live process (last pidof stdout=${JSON.stringify(lastPidOutput)}; last resumed Activity=${JSON.stringify(lastResumedActivity)}; am start stdout=${JSON.stringify(launched.stdout)}; am start stderr=${JSON.stringify(launched.stderr)})`);
  }

  const initialPids = launchPids;
  for (let sample = 0; sample < samples; sample++) {
    await sleep(intervalMs);
    const pids = validProcessIds((await invoke(["shell", "pidof", PACKAGE])).stdout);
    if (!pids) {
      throw new Error(`App process missing at observation ${sample + 1}`);
    }
    const identity = pids.join(" ");
    if (identity !== initialPids) throw new Error("App process restarted during observation");
  }
  const activities = await invoke(["shell", "dumpsys", "activity", "activities"]);
  if (!isMainActivityResumed(activities.stdout)) throw new Error("MainActivity is not the resumed activity");
  const installedPath = await invoke(["shell", "pm", "path", PACKAGE]);
  if (!/^package:\S+/m.test(installedPath.stdout)) throw new Error("Installed package path is missing");
  // Liveness and a resumed Activity do not exclude an ANR. Logcat was cleared
  // immediately before launch, so reject app-scoped failures from this run,
  // including a crash/restart before the first PID observation.
  // Filter at the source, not by truncating output: a busy emulator's full
  // system log can exceed maxBuffer even during a healthy launcher window.
  const logs = await invoke(["logcat", "-d", "-v", "brief",
    "-b", "main", "-b", "system", "-b", "crash",
    "AndroidRuntime:E", "ActivityManager:E", "ActivityTaskManager:E", "DEBUG:F", "*:S"]);
  if (/^[EF]\/AndroidRuntime\s*\([^\n)]*\):\s*Process:\s*app\.angelanexus(?:,|\s*$)/m.test(logs.stdout) ||
      /(?:^|\n)[^\n]*\bANR in app\.angelanexus(?:\s|$)/m.test(logs.stdout) ||
      />>>\s*app\.angelanexus\s*<<</.test(logs.stdout)) {
    throw new Error("App crash or ANR recorded during launcher observation");
  }
  return {
    package: PACKAGE,
    pids: initialPids,
    samples,
    observationMs: samples * intervalMs,
    launcher: launched,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runAndroidSmoke({ adb: process.env.ADB, apk: process.env.APK });
    console.log(`Launcher start stdout: ${JSON.stringify(result.launcher.stdout)}`);
    console.log(`Launcher start stderr: ${JSON.stringify(result.launcher.stderr)}`);
    console.log(`Android runtime smoke test passed: install and actual foreground launch verified; same process alive for ${result.observationMs} ms; MainActivity resumed.`);
    console.log("Launcher smoke only: no VPN/TUN, proxy traffic, leak or battery validation.");
  } catch (error) {
    console.error(`Android runtime smoke test FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
