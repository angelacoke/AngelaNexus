import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = process.cwd();
const script = join(root, "scripts", "verify-android-debug-native-package.py");
const prepareScript = join(root, "scripts", "prepare-android-debug-evidence.py");
const bridge = join(root, "native", "android", "xray-bridge");
const lockSource = join(bridge, "source-lock.json");
const shaBytes = (value) => createHash("sha256").update(value).digest("hex");
const shaFile = (path) => shaBytes(readFileSync(path));
const output = (result) => `${result.stdout}\n${result.stderr}`;

function pythonZip(path, entries, duplicate = false) {
  const payload = Object.entries(entries).map(([name, value]) => [name, Buffer.from(value).toString("base64")]);
  const code = `import base64,json,sys,zipfile\np=json.loads(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_STORED) as z:\n    for n,b in p:\n        z.writestr(n, base64.b64decode(b))\n        if ${duplicate ? "True" : "False"} and n == p[0][0]: z.writestr(n, base64.b64decode(b))\n`;
  const result = spawnSync("python3", ["-c", code, path, JSON.stringify(payload)], { encoding: "utf8" });
  assert.equal(result.status, 0, output(result));
}

function elf(machine, marker = "native", elfClass = machine === 40 ? 1 : 2, elfType = 3) {
  const data = Buffer.alloc(32, 0);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(data, 0);
  data[4] = elfClass;
  data[5] = 1; // little endian
  data.writeUInt16LE(elfType, 16); // ET_DYN shared object
  data.writeUInt16LE(machine, 18);
  Buffer.from(marker).copy(data, 20);
  return data;
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "android-debug-native-package-"));
  const fixtureRepo = join(dir, "repo");
  const fixtureBridge = join(fixtureRepo, "native", "android", "xray-bridge");
  mkdirSync(fixtureBridge, { recursive: true });
  cpSync(join(bridge, "verify-artifact.py"), join(fixtureBridge, "verify-artifact.py"));
  // Keep the real lock as the authenticated fixture input; no historical workspace artifact is used.
  cpSync(lockSource, join(fixtureBridge, "source-lock.json"));
  const projectCommit = "0123456789abcdef0123456789abcdef01234567";
  const lock = JSON.parse(readFileSync(lockSource, "utf8"));
  const sourceLockSha256 = shaFile(lockSource);
  const aarEntries = { "classes.jar": Buffer.from("fixture classes"), "jni/arm64-v8a/libgojni.so": elf(183), "jni/armeabi-v7a/libgojni.so": elf(40), "jni/x86_64/libgojni.so": elf(62) };
  const apkEntries = { "AndroidManifest.xml": Buffer.from("binary manifest"), "classes.dex": Buffer.from("dex fixture"), "lib/arm64-v8a/libgojni.so": aarEntries["jni/arm64-v8a/libgojni.so"], "lib/armeabi-v7a/libgojni.so": aarEntries["jni/armeabi-v7a/libgojni.so"], "lib/x86_64/libgojni.so": aarEntries["jni/x86_64/libgojni.so"] };
  for (const abi of ["arm64-v8a", "armeabi-v7a", "x86_64"]) {
    apkEntries[`lib/${abi}/libmihomo-jni.so`] = Buffer.from(`shim-${abi}`);
    apkEntries[`lib/${abi}/libclash.so`] = Buffer.from(`core-${abi}`);
  }
  const aar = join(dir, "fixture.aar");
  const apk = join(dir, "fixture.apk");
  const provenance = join(dir, "provenance.json");
  const report = join(dir, "report.json");
  pythonZip(aar, aarEntries);
  pythonZip(apk, apkEntries);

  const provenanceData = {
    version: lock.version,
    kernel: "xray",
    projectCommit,
    platform: "android",
    abi: "all",
    wrapper: { repository: lock.wrapper.repository, commit: lock.wrapper.commit },
    core: { repository: lock.core.repository, commit: lock.core.commit, version: lock.core.version },
    sourceLockSha256,
    patch: lock.patch,
    inputs: {
      wrapper: Object.fromEntries(Object.entries(lock.wrapper.files).map(([rel, spec]) => [rel, typeof spec === "string" ? spec : spec.before])),
      core: Object.fromEntries(Object.entries(lock.core.files).map(([rel, spec]) => [rel, typeof spec === "string" ? spec : spec.before])),
    },
    outputs: { core: Object.fromEntries(Object.entries(lock.core.files).map(([rel, spec]) => [rel, typeof spec === "string" ? spec : spec.after])) },
    tests: lock.tests,
    toolchain: {
      requested: lock.toolchain,
      actual: `go version ${lock.toolchain} linux/amd64`,
      androidNdk: "28.0.13004108",
      gomobile: "v0.0.0-20260908204917-8b95e45f8d3e",
      java: "openjdk version \"17.0.13\" 2024-10-15",
    },
    artifact: { name: "fixture.aar", sha256: shaFile(aar) },
    postprocessing: { operation: "remove duplicate go/ Java classes", inputSha256: "a".repeat(64), outputSha256: shaFile(aar) },
  };
  writeFileSync(provenance, JSON.stringify(provenanceData, null, 2) + "\n");
  return { dir, fixtureRepo, aar, apk, provenance, report, data: provenanceData, apkEntries, aarEntries, projectCommit };
}

function run(f, mutate = () => {}, options = {}) {
  mutate(f);
  return spawnSync("python3", [script, "--apk", f.apk, "--aar", f.aar, "--provenance", f.provenance, "--expected-commit", options.expectedCommit ?? f.projectCommit, "--repo-root", f.fixtureRepo, "--report", f.report], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_SHA: options.githubSha ?? "" } });
}
function rewriteProvenance(f, mutate) {
  const data = JSON.parse(readFileSync(f.provenance, "utf8"));
  mutate(data);
  writeFileSync(f.provenance, JSON.stringify(data, null, 2) + "\n");
}
function clean(f) { rmSync(f.dir, { recursive: true, force: true }); }

function prepareFixture(metadata) {
  const dir = mkdtempSync(join(tmpdir(), "android-debug-evidence-"));
  const mockBin = join(dir, "bin");
  mkdirSync(mockBin);
  const metadataPath = join(dir, "metadata.json");
  writeFileSync(metadataPath, JSON.stringify(metadata));
  const mockGh = join(mockBin, "gh");
  writeFileSync(mockGh, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "api") { process.stdout.write(readFileSync(process.env.MOCK_METADATA, "utf8")); process.exit(0); }
if (args[0] === "run" && args[1] === "download") {
  const out = args[args.indexOf("--dir") + 1]; mkdirSync(out, { recursive: true });
  for (const name of ["libXray.aar", "libbox.aar", "libbox-legacy.aar"]) writeFileSync(join(out, name), name);
  writeFileSync(join(out, "libxray-provenance.json"), JSON.stringify({ projectCommit: process.env.SOURCE_COMMIT }) + "\\n");
  process.exit(0);
}
process.exit(2);
`);
  chmodSync(mockGh, 0o755);
  return { dir, mockBin, metadataPath, output: join(dir, "artifacts") };
}
function runPrepare(f, sourceCommit = "0123456789abcdef0123456789abcdef01234567") {
  return spawnSync("python3", [prepareScript, "--run-id", "12345", "--source-commit", sourceCommit, "--output", f.output], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${f.mockBin}:${process.env.PATH}`, MOCK_METADATA: f.metadataPath, SOURCE_COMMIT: sourceCommit, GITHUB_REPOSITORY: "example/angelanexus" },
  });
}
function validRunMetadata(sourceCommit = "0123456789abcdef0123456789abcdef01234567") {
  return { head_sha: sourceCommit, status: "completed", conclusion: "success", path: ".github/workflows/android-build.yml", repository: { full_name: "example/angelanexus" }, head_repository: { full_name: "example/angelanexus" }, event: "push" };
}

 test("接受包含三种 ABI、JNI shim、manifest 和 dex 的有效 APK/AAR fixture", () => {
  const f = makeFixture();
  try { const result = run(f); assert.equal(result.status, 0, output(result)); const report = JSON.parse(readFileSync(f.report, "utf8")); assert.equal(report.verified, true); assert.deepEqual(report.libraries.map((row) => row.abi), ["arm64-v8a", "armeabi-v7a", "x86_64"]); } finally { clean(f); }
});

for (const [name, mutate] of [
  ["missing ABI", (f) => { const entries = { ...f.apkEntries }; delete entries["lib/x86_64/libgojni.so"]; pythonZip(f.apk, entries); }],
  ["extra ABI", (f) => pythonZip(f.apk, { ...f.apkEntries, "lib/mips/libgojni.so": elf(8) })],
  ["native content tampering", (f) => pythonZip(f.apk, { ...f.apkEntries, "lib/arm64-v8a/libgojni.so": elf(183, "tampered") })],
  ["wrong ELF architecture", (f) => { const aarEntries = { ...f.aarEntries, "jni/arm64-v8a/libgojni.so": elf(40) }; const apkEntries = { ...f.apkEntries, "lib/arm64-v8a/libgojni.so": elf(40) }; pythonZip(f.aar, aarEntries); pythonZip(f.apk, apkEntries); rewriteProvenance(f, (d) => { d.artifact.sha256 = shaFile(f.aar); d.postprocessing.outputSha256 = shaFile(f.aar); }); }],
  ["wrong ELF class", (f) => { const aarEntries = { ...f.aarEntries, "jni/arm64-v8a/libgojni.so": elf(183, "wrong-class", 1) }; const apkEntries = { ...f.apkEntries, "lib/arm64-v8a/libgojni.so": aarEntries["jni/arm64-v8a/libgojni.so"] }; pythonZip(f.aar, aarEntries); pythonZip(f.apk, apkEntries); rewriteProvenance(f, (d) => { d.artifact.sha256 = shaFile(f.aar); d.postprocessing.outputSha256 = shaFile(f.aar); }); }],
  ["non-shared ELF type", (f) => { const aarEntries = { ...f.aarEntries, "jni/arm64-v8a/libgojni.so": elf(183, "not-shared", 2, 2) }; const apkEntries = { ...f.apkEntries, "lib/arm64-v8a/libgojni.so": aarEntries["jni/arm64-v8a/libgojni.so"] }; pythonZip(f.aar, aarEntries); pythonZip(f.apk, apkEntries); rewriteProvenance(f, (d) => { d.artifact.sha256 = shaFile(f.aar); d.postprocessing.outputSha256 = shaFile(f.aar); }); }],
  ["missing JNI shim", (f) => { const entries = { ...f.apkEntries }; delete entries["lib/arm64-v8a/libmihomo-jni.so"]; pythonZip(f.apk, entries); }],
  ["missing APK manifest", (f) => { const entries = { ...f.apkEntries }; delete entries["AndroidManifest.xml"]; pythonZip(f.apk, entries); }],
  ["missing APK dex", (f) => { const entries = { ...f.apkEntries }; delete entries["classes.dex"]; pythonZip(f.apk, entries); }],
]) test(`拒绝 ${name}`, () => { const f = makeFixture(); try { const result = run(f, mutate); assert.notEqual(result.status, 0, output(result)); const reasons = { "native content tampering": "APK/AAR native SHA-256 mismatch", "wrong ELF architecture": "ELF machine mismatch", "wrong ELF class": "ELF class mismatch", "non-shared ELF type": "ELF is not a shared object", "missing ABI": "APK Xray ABI set mismatch", "extra ABI": "APK Xray ABI set mismatch", "missing JNI shim": "missing existing JNI shim", "missing APK manifest": "not an APK application", "missing APK dex": "not an APK application" }; assert.match(result.stderr, new RegExp(reasons[name])); } finally { clean(f); } });

for (const [name, mutate] of [
  ["project SHA", (d) => { d.projectCommit = "fedcba9876543210fedcba9876543210fedcba98"; }],
  ["source-lock SHA", (d) => { d.sourceLockSha256 = "0".repeat(64); }],
  ["output hash", (d) => { d.outputs.core[Object.keys(d.outputs.core)[0]] = "0".repeat(64); }],
  ["AAR hash", (d) => { d.artifact.sha256 = "0".repeat(64); d.postprocessing.outputSha256 = "0".repeat(64); }],
]) test(`拒绝 provenance ${name} 错误`, () => { const f = makeFixture(); try { const result = run(f, (x) => rewriteProvenance(x, mutate)); assert.notEqual(result.status, 0, output(result)); const reasons = { "project SHA": "source project commit mismatch", "source-lock SHA": "source lock hash mismatch", "output hash": "output hash mismatch", "AAR hash": "AAR provenance digest/name mismatch" }; assert.match(result.stderr, new RegExp(reasons[name])); } finally { clean(f); } });

test("拒绝重复 ZIP entry", () => { const f = makeFixture(); try { pythonZip(f.apk, f.apkEntries, true); const result = run(f); assert.notEqual(result.status, 0, output(result)); assert.match(result.stderr, /duplicate ZIP entry/); } finally { clean(f); } });

test("拒绝 expected commit 非 40 位十六进制", () => { const f = makeFixture(); try { const result = run(f, () => {}, { expectedCommit: "not-a-sha" }); assert.notEqual(result.status, 0, output(result)); assert.match(result.stderr, /expected commit must be a full SHA/); } finally { clean(f); } });

test("GITHUB_SHA 不同仍按显式 source SHA 成功回放", () => { const f = makeFixture(); try { const result = run(f, () => {}, { githubSha: "fedcba9876543210fedcba9876543210fedcba98" }); assert.equal(result.status, 0, output(result)); } finally { clean(f); } });

for (const [name, mutate] of [
  ["sha", (m) => { m.head_sha = "fedcba9876543210fedcba9876543210fedcba98"; }],
  ["status", (m) => { m.status = "in_progress"; }],
  ["conclusion", (m) => { m.conclusion = "failure"; }],
  ["path", (m) => { m.path = ".github/workflows/other.yml"; }],
  ["repository", (m) => { m.repository.full_name = "evil/repo"; }],
  ["head_repository", (m) => { m.head_repository.full_name = "evil/repo"; }],
  ["PR event", (m) => { m.event = "pull_request"; }],
]) test(`prepare 拒绝 metadata ${name}`, () => { const source = "0123456789abcdef0123456789abcdef01234567"; const metadata = validRunMetadata(source); mutate(metadata); const f = prepareFixture(metadata); try { const result = runPrepare(f, source); assert.notEqual(result.status, 0, output(result)); const reasons = { sha: "source run head_sha mismatch", status: "source run status mismatch", conclusion: "source run conclusion mismatch", path: "source run path mismatch", repository: "source repository mismatch", head_repository: "source repository mismatch", "PR event": "replay requires a direct source checkout" }; assert.match(result.stderr, new RegExp(reasons[name])); } finally { clean(f); } });

test("prepare 合法 metadata mock download 生成四个文件并保留 provenance source SHA", () => { const source = "0123456789abcdef0123456789abcdef01234567"; const f = prepareFixture(validRunMetadata(source)); try { const result = runPrepare(f, source); assert.equal(result.status, 0, output(result)); assert.deepEqual(readdirSync(f.output).sort(), ["libXray.aar", "libbox-legacy.aar", "libbox.aar", "libxray-provenance.json"].sort()); assert.equal(JSON.parse(readFileSync(join(f.output, "libxray-provenance.json"))).projectCommit, source); } finally { clean(f); } });

test("校验失败会清除 stale report", () => { const f = makeFixture(); try { writeFileSync(f.report, "stale success evidence\n"); const result = run(f, (x) => { const entries = { ...x.apkEntries }; delete entries["classes.dex"]; pythonZip(x.apk, entries); }); assert.notEqual(result.status, 0, output(result)); assert.equal(existsSync(f.report), false); } finally { clean(f); }
});

test("debug-only replay skips native rebuild and has no release task or credentials", () => {
  const workflow = readFileSync(join(root, ".github/workflows/xray-android-native-build.yml"), "utf8");
  assert.match(workflow, /build:\s+if: \$\{\{ inputs\.evidence_android_run == '' \}\}/);
  const replay = workflow.slice(workflow.indexOf("  debug-packaging-evidence:"));
  assert.match(replay, /github\.event_name == 'workflow_dispatch'/);
  assert.match(replay, /permissions:\s+actions: read\s+contents: read/);
  assert.match(replay, /-Pangelanexus\.debugNativePackagingEvidence=true assembleDebug/);
  assert.match(replay, /verify-android-debug-native-package\.py/);
  assert.doesNotMatch(replay, /assembleRelease|bundleRelease|ANGELANEXUS_RELEASE_|secrets\./);
});

test("debug evidence mode preserves original JNI bytes and refuses non-debug Gradle tasks", () => {
  const gradle = readFileSync(join(root, "native/android/app/build.gradle.kts"), "utf8");
  assert.match(gradle, /gradle\.startParameter\.taskNames\.isNotEmpty\(\) && gradle\.startParameter\.taskNames\.all/);
  assert.match(gradle, /it\.substringAfterLast\(":"\) == "assembleDebug"/);
  assert.match(gradle, /if \(debugNativePackagingEvidence\) \{\s+keepDebugSymbols\.add\("\*\*\/libgojni\.so"\)/);
  const workflow = readFileSync(join(root, ".github/workflows/android-build.yml"), "utf8");
  const debug = workflow.slice(workflow.indexOf("  android-debug:"), workflow.indexOf("  android-release:"));
  assert.match(debug, /-Pangelanexus\.debugNativePackagingEvidence=true assembleDebug/);
  assert.ok(debug.indexOf("verify-android-debug-native-package.py") > debug.indexOf("assembleDebug"));
});
