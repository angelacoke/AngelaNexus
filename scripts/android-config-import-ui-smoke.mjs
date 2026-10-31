import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const adb = process.env.ADB;
const packageName = "app.angelanexus";
const activityName = `${packageName}/.MainActivity`;
const fixtureFile = "/sdcard/Download/angelanexus-ui-fixture.txt";
const fixtureContent = "vless://user@node-fixture.invalid:443";
const expectedSubscriptionUrl = "https://10.0.2.2:18443/subscription";
const subscriptionUrl = process.env.SUBSCRIPTION_URL ?? expectedSubscriptionUrl;
const commandTimeoutMs = 30_000;
const uiDumpPath = "/sdcard/window.xml";
let lastUiDumpDiagnostic = "no UI dump attempted";
const successTexts = [
  "Configuration imported by Core. Runtime start is a separate step.",
  "Core 已完成配置导入；启动运行时是独立步骤。",
];
const profileReadyTexts = ["Core import verified", "核心导入已验证"];
const oneNodeTexts = ["Detected nodes: 1", "检测节点数：1"];
const uiStrings = {
  home: ["Home", "首页"],
  profiles: ["Profiles", "配置"],
  addConfig: ["Add configuration", "添加配置"],
  importTitle: ["Choose an import source", "选择导入方式"],
  subscription: ["Subscription URL", "订阅链接"],
  localFile: ["Local file", "本地文件"],
  pastedText: ["Paste configuration or node links", "粘贴配置或节点链接"],
  textLabel: ["Configuration text", "配置文本"],
  subscriptionLabel: ["Subscription address", "订阅地址"],
  importAction: ["Import", "导入"],
};

function requireAdb() {
  if (!adb) throw new Error("ADB environment variable is required");
}

async function runAdb(args, timeout = commandTimeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(adb, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout, stderr };
  } catch (error) {
    const stdout = typeof error?.stdout === "string" ? error.stdout : "";
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    throw new Error(
      `adb ${args.slice(0, 4).join(" ")} failed: ${error.message}; stdout=${JSON.stringify(stdout)}; stderr=${JSON.stringify(stderr)}`,
      { cause: error },
    );
  }
}

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function parseNodes(xml) {
  const nodes = [];
  for (const match of xml.matchAll(/<node\b([^>]*)\/?\s*>/g)) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)]
        .map(([, key, value]) => [key, decodeXml(value)]),
    );
    const bounds = attrs.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (bounds) {
      nodes.push({
        text: attrs.text ?? "",
        description: attrs["content-desc"] ?? "",
        className: attrs.class ?? "",
        bounds: bounds.slice(1).map(Number),
        clickable: attrs.clickable === "true",
        focused: attrs.focused === "true",
      });
    }
  }
  return nodes;
}

async function readUi() {
  try {
    await runAdb(["shell", "rm", "-f", uiDumpPath]);
    const dump = await runAdb(["shell", "uiautomator", "dump", uiDumpPath], 45_000);
    const { stdout, stderr } = await runAdb(["exec-out", "cat", uiDumpPath]);
    if (!stdout.includes("<hierarchy")) {
      lastUiDumpDiagnostic = `no hierarchy XML; dump=${JSON.stringify(dump.stdout).slice(0, 240)}; dump stderr=${JSON.stringify(dump.stderr).slice(0, 240)}; file bytes=${Buffer.byteLength(stdout)}; cat stderr=${JSON.stringify(stderr).slice(0, 240)}; file preview=${JSON.stringify(stdout.slice(0, 240))}`;
      return [];
    }
    lastUiDumpDiagnostic = `hierarchy XML read (${Buffer.byteLength(stdout)} bytes)`;
    return parseNodes(stdout);
  } catch (error) {
    lastUiDumpDiagnostic = `UIAutomator read failed: ${String(error?.message ?? error).slice(0, 480)}`;
    return [];
  }
}

function findNode(nodes, labels) {
  const matches = nodes.filter((node) => labels.includes(node.text) || labels.includes(node.description));
  return matches.find((node) => node.clickable) ?? matches[0];
}

function textSummary(nodes) {
  return [...new Set(nodes.flatMap((node) => [node.text, node.description]).filter(Boolean))]
    .slice(0, 100)
    .join(" | ");
}

async function waitForNode(labels, { timeoutMs = 30_000, context = "UI" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastNodes = [];
  while (Date.now() < deadline) {
    lastNodes = await readUi();
    const node = findNode(lastNodes, labels);
    if (node) return node;
    await delay(750);
  }
  throw new Error(`Timed out waiting for ${context} (${labels.join(" / ")}); visible=${textSummary(lastNodes)}; UI dump=${lastUiDumpDiagnostic}`);
}

async function tapNode(node) {
  const [left, top, right, bottom] = node.bounds;
  const x = Math.round((left + right) / 2);
  const y = Math.round((top + bottom) / 2);
  await runAdb(["shell", "input", "tap", String(x), String(y)]);
  await delay(500);
}

async function tapText(labels, context = labels.join(" / ")) {
  const node = await waitForNode(labels, { context });
  await tapNode(node);
}

async function clickVisible(labels, context = labels.join(" / ")) {
  const nodes = await readUi();
  const node = findNode(nodes, labels);
  if (!node) throw new Error(`Could not find ${context}; visible=${textSummary(nodes)}`);
  await tapNode(node);
}

async function typeText(value, fieldLabels) {
  await runAdb(["shell", "input", "text", value]);
  const deadline = Date.now() + 10_000;
  let lastNodes = [];
  while (Date.now() < deadline) {
    lastNodes = await readUi();
    const field = findNode(lastNodes, fieldLabels);
    const hasReadback = lastNodes.some((node) => node.text.includes(value));
    if (hasReadback || (field?.focused && field.text.includes(value))) return;
    await delay(500);
  }
  throw new Error(`Typed value was not visible in ${fieldLabels.join(" / ")}; visible=${textSummary(lastNodes)}`);
}

async function hideKeyboardAndVerifyImportButton() {
  await runAdb(["shell", "input", "keyevent", "4"]);
  await delay(400);
  await waitForNode(uiStrings.importAction, { context: "visible Import button after closing keyboard" });
}

async function launchCleanApp() {
  await runAdb(["shell", "am", "force-stop", packageName]);
  await runAdb(["shell", "pm", "clear", packageName], 60_000);
  await runAdb(["shell", "am", "start", "-n", activityName]);
  await waitForNode(["AngelaNexus"], { timeoutMs: 60_000, context: "AngelaNexus main screen" });
}

async function openImportSource(sourceLabels) {
  await tapText(uiStrings.profiles, "Profiles navigation tab");
  await tapText(uiStrings.addConfig, "Add configuration button");
  await waitForNode(uiStrings.importTitle, { context: "import-source dialog" });
  await tapText(sourceLabels, "selected import source");
}

async function assertSuccessfulImport(sourceName) {
  await waitForNode(successTexts, { timeoutMs: 60_000, context: `${sourceName} success status` });
  await waitForNode(profileReadyTexts, { timeoutMs: 30_000, context: `${sourceName} profile result` });
  await tapText(uiStrings.home, "Home navigation tab");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const nodes = await readUi();
    if (findNode(nodes, oneNodeTexts)) {
      console.log(`PASS ${sourceName}: Core success status, profile result, and exactly one node are visible`);
      return;
    }
    await runAdb(["shell", "input", "swipe", "540", "1650", "540", "600", "350"]);
    await delay(500);
  }
  throw new Error(`Expected exactly one imported node after ${sourceName}; visible=${textSummary(await readUi())}`);
}

async function testTextImport() {
  await launchCleanApp();
  await openImportSource(uiStrings.pastedText);
  await waitForNode(uiStrings.textLabel, { context: "pasted configuration field" });
  await clickVisible(uiStrings.textLabel, "pasted configuration field");
  await typeText(fixtureContent, uiStrings.textLabel);
  await hideKeyboardAndVerifyImportButton();
  await tapText(uiStrings.importAction, "Import pasted configuration button");
  await assertSuccessfulImport("pasted text/node link");
}

async function testSubscriptionImport() {
  await launchCleanApp();
  await openImportSource(uiStrings.subscription);
  await waitForNode(uiStrings.subscriptionLabel, { context: "subscription URL field" });
  await clickVisible(uiStrings.subscriptionLabel, "subscription URL field");
  await typeText(subscriptionUrl, uiStrings.subscriptionLabel);
  await hideKeyboardAndVerifyImportButton();
  await tapText(uiStrings.importAction, "Import subscription button");
  await assertSuccessfulImport("HTTPS subscription fixture");
}

async function chooseFixtureInDocumentPicker() {
  const filename = fixtureFile.split("/").at(-1);
  const deadline = Date.now() + 60_000;
  let lastNodes = [];
  while (Date.now() < deadline) {
    lastNodes = await readUi();
    const file = findNode(lastNodes, [filename]);
    if (file) {
      await tapNode(file);
      return;
    }
    const downloads = findNode(lastNodes, ["Downloads", "Download", "下载"]);
    if (downloads) {
      await tapNode(downloads);
      await delay(500);
      continue;
    }
    const roots = findNode(lastNodes, ["Show roots", "Show root", "Show navigation drawer", "Open navigation drawer", "显示根目录", "显示导航抽屉"]);
    if (roots) {
      await tapNode(roots);
      await delay(500);
      continue;
    }
    await delay(750);
  }
  let currentActivity = "unavailable";
  try {
    const { stdout } = await runAdb(["shell", "dumpsys", "activity", "activities"]);
    currentActivity = stdout.split("\n").filter((line) => /mResumedActivity|mCurrentFocus/.test(line)).slice(-3).join("; ").trim() || "not reported";
  } catch {}
  throw new Error(`Could not locate the test file in Android's document picker; activity=${currentActivity}; visible=${textSummary(lastNodes)}`);
}

async function testLocalFileImport() {
  await runAdb(["shell", "mkdir", "-p", "/sdcard/Download"]);
  await runAdb(["push", process.env.FIXTURE_LOCAL_PATH, fixtureFile]);
  await runAdb(["shell", "ls", "-l", fixtureFile]);
  await launchCleanApp();
  await openImportSource(uiStrings.localFile);
  await chooseFixtureInDocumentPicker();
  await assertSuccessfulImport("local SAF file");
}

async function main() {
  requireAdb();
  if (!process.env.FIXTURE_LOCAL_PATH) throw new Error("FIXTURE_LOCAL_PATH is required");
  if (subscriptionUrl !== expectedSubscriptionUrl) {
    throw new Error(`Subscription fixture URL must equal ${expectedSubscriptionUrl}`);
  }
  await testTextImport();
  await testLocalFileImport();
  await testSubscriptionImport();
  console.log("UI IMPORT TESTS PASSED: pasted text, SAF local file, HTTPS subscription fixture. No VPN or proxy runtime was started.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Android configuration import UI test FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
