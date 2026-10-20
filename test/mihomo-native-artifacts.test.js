import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64"];
const COMMIT = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36";
const REPOSITORY = "https://github.com/MetaCubeX/mihomo";
const verifier = join(process.cwd(), "scripts/verify-mihomo-native-artifacts.py");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mihomo-verifier-"));
  const artifacts = join(root, "artifacts");
  const bridge = Buffer.from("fixture bridge\n");
  const lifecycle = Buffer.from("fixture lifecycle\n");
  const sourceDir = join(root, "native/android/mihomo-bridge");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "bridge.go"), bridge);
  writeFileSync(join(sourceDir, "lifecycle.go"), lifecycle);
  const records = {};
  for (const abi of ABIS) {
    const bytes = Buffer.from(`fixture native ${abi}\n`);
    const sha = digest(bytes);
    mkdirSync(join(artifacts, abi), { recursive: true });
    writeFileSync(join(artifacts, abi, `libclash-${abi}.so`), bytes);
    records[abi] = { file: "libclash.so", sha256: sha };
  }
  const kotlinDir = join(root, "native/android/app/src/main/kotlin/app/angelanexus");
  mkdirSync(kotlinDir, { recursive: true });
  writeFileSync(join(kotlinDir, "MihomoNativeArtifactManifest.kt"), `package app.angelanexus
object MihomoNativeArtifactManifest {
 const val VERSION = "v1.19.32"
 const val SOURCE_COMMIT = "${COMMIT}"
${ABIS.map((abi) => ` val ${abi.replaceAll("-", "_")} = MihomoNativeLibrarySpec(abi = "${abi}", sha256 = "${records[abi].sha256}")`).join("\n")}
}`);
  const complianceDir = join(root, "docs/upstream");
  mkdirSync(complianceDir, { recursive: true });
  writeFileSync(join(complianceDir, "MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json"), JSON.stringify({
    runtime: { kernel: "mihomo", version: "1.19.32", platform: "android", abis: ABIS },
    source: { repository: REPOSITORY, pinnedCommit: COMMIT },
    artifacts: records,
  }));
  for (const abi of ABIS) {
    const artifact = `libclash-${abi}.so`;
    writeFileSync(join(artifacts, abi, `mihomo-provenance-${abi}.json`), JSON.stringify({
      version: 1, kernel: "mihomo", kernelVersion: "1.19.32", platform: "android", abi,
      source: { repository: REPOSITORY, commit: COMMIT },
      toolchain: { go: "go version go1.24.8 linux/amd64", androidNdk: "28.0.13004108", compiler: "Android clang", goos: "android", goarch: abi === "arm64-v8a" ? "arm64" : abi === "armeabi-v7a" ? "arm" : "amd64", goarm: abi === "armeabi-v7a" ? "7" : null, cgoEnabled: true },
      build: { trimpath: true, buildmode: "c-shared", tags: ["with_gvisor", "cmfa"], versionLdflag: "github.com/metacubex/mihomo/constant.Version=v1.19.32" },
      bridge: { path: "native/android/mihomo-bridge/bridge.go", sha256: digest(bridge) },
      lifecycle: { path: "native/android/mihomo-bridge/lifecycle.go", sha256: digest(lifecycle) },
      artifact: { name: artifact, sha256: records[abi].sha256 },
    }));
  }
  return { root, artifacts };
}
function run(fx) {
  return spawnSync("python3", [verifier, "--artifacts-root", fx.artifacts, "--repo-root", fx.root], { encoding: "utf8" });
}
function mutate(fx, abi, edit) {
  const path = join(fx.artifacts, abi, `mihomo-provenance-${abi}.json`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, JSON.stringify(data));
}
function withFixture(fn) {
  const fx = fixture();
  try { fn(fx); } finally { rmSync(fx.root, { recursive: true, force: true }); }
}

test("verifies complete, exact Mihomo fixture", () => withFixture((fx) => {
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
}));

test("rejects artifact tampering", () => withFixture((fx) => {
  writeFileSync(join(fx.artifacts, "arm64-v8a", "libclash-arm64-v8a.so"), "tampered");
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ABI arm64-v8a artifact SHA-256 mismatch/);
}));

test("rejects provenance artifact hash tampering with the specific reason", () => withFixture((fx) => {
  mutate(fx, "armeabi-v7a", (p) => { p.artifact.sha256 = "0".repeat(64); });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance armeabi-v7a artifact SHA-256 mismatch/);
}));

test("rejects provenance source repository mismatch with the specific reason", () => withFixture((fx) => {
  mutate(fx, "armeabi-v7a", (p) => { p.source.repository = "https://evil.invalid/mihomo"; });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance armeabi-v7a source repository mismatch/);
}));

test("rejects Kotlin/docs hash disagreement", () => withFixture((fx) => {
  const path = join(fx.root, "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json");
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.artifacts["x86_64"].sha256 = "f".repeat(64);
  writeFileSync(path, JSON.stringify(data));
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /compliance artifact x86_64 SHA-256 mismatch/);
}));

test("rejects ABI mismatch", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { p.abi = "x86_64"; });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance ABI mismatch: expected arm64-v8a/);
}));

test("rejects missing ABI directory and duplicate/extra files", () => withFixture((fx) => {
  rmSync(join(fx.artifacts, "x86_64"), { recursive: true });
  const missing = run(fx);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing artifact directory for ABI x86_64/);
  const fresh = fixture();
  try {
    writeFileSync(join(fresh.artifacts, "arm64-v8a", "duplicate.so"), "extra");
    const extra = run(fresh);
    assert.notEqual(extra.status, 0);
    assert.match(extra.stderr, /ABI arm64-v8a must contain exactly/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects checkout bridge/lifecycle source digest changes", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "native/android/mihomo-bridge/bridge.go"), "changed");
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bridge source digest mismatch/);
}));

test("rejects malformed JSON and typed fields without a traceback", () => withFixture((fx) => {
  const path = join(fx.artifacts, "arm64-v8a", "mihomo-provenance-arm64-v8a.json");
  writeFileSync(path, Buffer.from([0xff, 0xfe, 0xfd]));
  const invalid = run(fx);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /invalid provenance for arm64-v8a/);
  assert.doesNotMatch(invalid.stderr, /Traceback/);

  const typed = fixture();
  try {
    mutate(typed, "arm64-v8a", (p) => { p.artifact.sha256 = 42; });
    const result = run(typed);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /provenance\.artifact arm64-v8a\.sha256 must be a string/);
    assert.doesNotMatch(result.stderr, /Traceback/);
  } finally { rmSync(typed.root, { recursive: true, force: true }); }
}));

test("rejects toolchain contract mismatches with the specific reason", () => withFixture((fx) => {
  mutate(fx, "x86_64", (p) => { p.toolchain.goos = "linux"; });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /provenance x86_64 toolchain goos mismatch/);
}));

test("verifier is wired before any install mkdir/copy and compliance gate remains fail-closed", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/android-native-package.yml"), "utf8");
  const verify = workflow.indexOf("python3 scripts/verify-mihomo-native-artifacts.py");
  const mkdir = workflow.indexOf("mkdir -p native/android/app/src/main/jniLibs");
  const copy = workflow.indexOf("install -m 0644");
  assert.ok(verify >= 0, "workflow must invoke the verifier");
  assert.ok(mkdir > verify, "verifier must precede mkdir");
  assert.ok(copy > verify, "verifier must precede artifact installation/copy");
  assert.match(workflow, /distributionStatus.*approved/);
  assert.match(workflow, /all\(gates\.values\(\)\)/);
  assert.match(workflow, /if: \$\{\{ needs\.compliance-gate\.outputs\.approved == 'true' \}\}/);
});

test("rejects a missing Kotlin hash without borrowing the next ABI's hash", () => withFixture((fx) => {
  const path = join(fx.root, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt");
  const source = readFileSync(path, "utf8").replace(/(abi = "arm64-v8a"), sha256 = "[0-9a-f]+"/, "$1");
  writeFileSync(path, source);
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Kotlin Mihomo manifest has no valid hash for ABI arm64-v8a/);
}));

test("rejects duplicate Kotlin ABI specs", () => withFixture((fx) => {
  const path = join(fx.root, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt");
  const source = readFileSync(path, "utf8").replace('abi = "armeabi-v7a"', 'abi = "arm64-v8a"');
  writeFileSync(path, source);
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Kotlin Mihomo manifest has duplicate ABI spec arm64-v8a/);
}));
