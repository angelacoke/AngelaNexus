import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 10_000;
const REPORT_INTERVAL_MS = 15_000;
const UNAVAILABLE_OUTPUT = /(?:can't find service|failure calling service|service\s+\w+\s*:\s*not found|device offline|error:|exception)/i;

const PROBES = [
  {
    label: "ADB device state",
    args: ["get-state"],
    ready: output => output.trim() === "device",
  },
  {
    label: "sys.boot_completed",
    args: ["shell", "getprop", "sys.boot_completed"],
    ready: output => output.trim() === "1",
  },
  {
    label: "settings service",
    args: ["shell", "service", "check", "settings"],
    ready: output => /^Service\s+settings:\s*found\s*$/im.test(output),
  },
  {
    label: "settings provider query",
    args: ["shell", "settings", "get", "system", "screen_off_timeout"],
    ready: output => output.trim().length > 0 && !UNAVAILABLE_OUTPUT.test(output),
  },
  {
    label: "package service",
    args: ["shell", "service", "check", "package"],
    ready: output => /^Service\s+package:\s*found\s*$/im.test(output),
  },
  {
    label: "framework package manager query",
    args: ["shell", "pm", "path", "android"],
    ready: output => /^package:\S+/m.test(output),
  },
  {
    label: "activity service",
    args: ["shell", "service", "check", "activity"],
    ready: output => /^Service\s+activity:\s*found\s*$/im.test(output),
  },
  {
    label: "activity manager current-user query",
    args: ["shell", "am", "get-current-user"],
    ready: output => /^\d+$/.test(output.trim()),
  },
];

const ANIMATION_SETTINGS = [
  ["shell", "settings", "put", "global", "window_animation_scale", "0"],
  ["shell", "settings", "put", "global", "transition_animation_scale", "0"],
  ["shell", "settings", "put", "global", "animator_duration_scale", "0"],
];

function brief(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
}

function describeError(error) {
  return brief(error?.stderr || error?.stdout || error?.message || error) || "command returned no output";
}

export async function waitForAndroidSystemServices({
  adb,
  timeoutMs = 180_000,
  intervalMs = 2_000,
  stableSamples = 3,
  command = async (args, timeout) => {
    const { stdout, stderr } = await execFileAsync(adb, args, {
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return [stdout, stderr].filter(Boolean).join("\n");
  },
  sleep = delay,
  now = Date.now,
  logger = console.log,
} = {}) {
  if (!adb) throw new Error("ADB executable is required");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000 ||
      !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 30_000 ||
      !Number.isInteger(stableSamples) || stableSamples < 2 || stableSamples > 10) {
    throw new Error("Invalid bounded Android readiness options");
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let stableRounds = 0;
  let lastIssue = "No readiness probes completed";
  let nextReportAt = startedAt + REPORT_INTERVAL_MS;

  while (now() < deadline) {
    let ready = true;
    for (const probe of PROBES) {
      const remainingMs = deadline - now();
      if (remainingMs <= 0) {
        ready = false;
        lastIssue = `Timed out before ${probe.label}`;
        break;
      }
      let output;
      try {
        output = String(await command(probe.args, Math.min(COMMAND_TIMEOUT_MS, remainingMs)) ?? "");
      } catch (error) {
        ready = false;
        lastIssue = `${probe.label} probe failed: ${describeError(error)}`;
        break;
      }
      if (!probe.ready(output)) {
        ready = false;
        lastIssue = `${probe.label} was not ready: ${brief(output) || "empty response"}`;
        break;
      }
    }

    if (ready) {
      stableRounds += 1;
      lastIssue = `All readiness probes passed ${stableRounds}/${stableSamples} consecutive rounds`;
      if (stableRounds >= stableSamples) {
        let writesReady = true;
        for (const args of ANIMATION_SETTINGS) {
          const remainingMs = deadline - now();
          if (remainingMs <= 0) {
            writesReady = false;
            lastIssue = `Timed out before ${args.slice(2).join(" ")}`;
            break;
          }
          try {
            const output = String(await command(args, Math.min(COMMAND_TIMEOUT_MS, remainingMs)) ?? "");
            if (UNAVAILABLE_OUTPUT.test(output)) {
              writesReady = false;
              lastIssue = `${args.slice(2).join(" ")} failed: ${brief(output)}`;
              break;
            }
          } catch (error) {
            writesReady = false;
            lastIssue = `${args.slice(2).join(" ")} failed: ${describeError(error)}`;
            break;
          }
        }
        if (writesReady) {
          return { stableSamples, waitedMs: now() - startedAt };
        }
        // A successful probe can race with a service restart. Require a fresh
        // stable window and successful settings writes before continuing.
        stableRounds = 0;
      }
    } else {
      stableRounds = 0;
    }

    if (now() >= nextReportAt) {
      logger(`Waiting for Android emulator system services (${now() - startedAt}ms elapsed): ${lastIssue}`);
      nextReportAt = now() + REPORT_INTERVAL_MS;
    }
    const remainingMs = deadline - now();
    if (remainingMs > 0) await sleep(Math.min(intervalMs, remainingMs));
  }

  throw new Error(`Android emulator system services did not stabilize within ${timeoutMs}ms: ${lastIssue}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const timeoutMs = Number(process.env.ANDROID_SYSTEM_READY_TIMEOUT_MS ?? 180_000);
    const result = await waitForAndroidSystemServices({ adb: process.env.ADB, timeoutMs });
    console.log(`Android emulator system services are stable (${result.stableSamples} consecutive probe rounds, ${result.waitedMs}ms).`);
  } catch (error) {
    console.error(`Android emulator readiness FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
