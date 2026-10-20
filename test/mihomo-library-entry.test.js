import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const root = process.cwd();
const read = path => readFileSync(join(root, path), "utf8");
const workflowText = read(".github/workflows/mihomo-android-native-build.yml");
const workflow = yaml.load(workflowText);
const steps = workflow.jobs.build.steps;
const step = name => steps.find(candidate => candidate.name === name);
const bridgeDir = "native/android/mihomo-bridge";
const libraryEntry = `${bridgeDir}/library.go`;

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function verifierFixture() {
  const fixture = mkdtempSync(join(tmpdir(), "mihomo-library-entry-"));
  const repo = join(fixture, "repo");
  const artifacts = join(fixture, "artifacts");
  const sourceDir = join(repo, bridgeDir);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(repo, "native/android/app/src/main/kotlin/app/angelanexus"), { recursive: true });
  for (const name of ["bridge.go", "lifecycle.go", "library.go"]) {
    writeFileSync(join(sourceDir, name), readFileSync(join(root, bridgeDir, name)));
  }
  const patchedSourceHash = digest("fixture patched source");
  const patchedStatisticsHash = digest("fixture patched statistics");
  const statisticsPatch = "fixture statistics patch\n";
  writeFileSync(join(sourceDir, "statistics.patch"), statisticsPatch);
  writeFileSync(join(sourceDir, "prepare-upstream.py"), `PATCHED_SERVER_SHA256 = "${patchedSourceHash}"\nPATCHED_STATISTICS_SHA256 = "${patchedStatisticsHash}"\nSTATISTICS_PATCH_SHA256 = "${digest(statisticsPatch)}"\n`);
  const abis = ["arm64-v8a", "armeabi-v7a", "x86_64"];
  const commit = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36";
  const specs = abis.map(abi => `MihomoNativeLibrarySpec(abi = "${abi}", sha256 = "${"a".repeat(64)}")`).join(",\n");
  writeFileSync(join(repo, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"),
    `const val VERSION = "v1.19.32"\nconst val SOURCE_COMMIT = "${commit}"\n${specs}\n`);
  const records = {};
  for (const abi of abis) {
    const artifact = `libclash-${abi}.so`;
    const artifactBytes = `artifact-${abi}`;
    const dir = join(artifacts, abi);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, artifact), artifactBytes);
    records[abi] = { file: "libclash.so", sha256: digest(artifactBytes) };
    const goarch = abi === "arm64-v8a" ? "arm64" : abi === "armeabi-v7a" ? "arm" : "amd64";
    const evidence = name => ({ path: `${bridgeDir}/${name}`, sha256: digest(readFileSync(join(sourceDir, name))) });
    const provenance = {
      version: 1, kernel: "mihomo", kernelVersion: "1.19.32", platform: "android", abi,
      source: { repository: "https://github.com/MetaCubeX/mihomo", commit },
      artifact: { name: artifact, sha256: digest(artifactBytes) },
      toolchain: { go: "go version go1.24.8 linux/amd64", androidNdk: "28.0.13004108", compiler: "Android clang", goos: "android", goarch, goarm: abi === "armeabi-v7a" ? "7" : null, cgoEnabled: true },
      build: { trimpath: true, buildmode: "c-shared", package: "./angelanexus_android", tags: ["with_gvisor", "cmfa"], versionLdflag: "github.com/metacubex/mihomo/constant.Version=v1.19.32" },
      bridge: evidence("bridge.go"), lifecycle: evidence("lifecycle.go"), libraryEntry: evidence("library.go"),
      ownershipAdapter: { ...evidence("prepare-upstream.py"), patchedSource: { path: "listener/sing_tun/server.go", sha256: patchedSourceHash } },
      statisticsPatch: { ...evidence("statistics.patch"), patchedSource: { path: "tunnel/statistic/manager.go", sha256: patchedStatisticsHash } },
    };
    writeFileSync(join(dir, `mihomo-provenance-${abi}.json`), JSON.stringify(provenance));
  }
  writeFileSync(join(repo, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"),
    `const val VERSION = "v1.19.32"\nconst val SOURCE_COMMIT = "${commit}"\n` + abis.map(abi => `MihomoNativeLibrarySpec(abi = "${abi}", sha256 = "${records[abi].sha256}")`).join("\n"));
  mkdirSync(join(repo, "docs/upstream"), { recursive: true });
  writeFileSync(join(repo, "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json"), JSON.stringify({
    runtime: { kernel: "mihomo", version: "1.19.32", platform: "android", abis },
    source: { repository: "https://github.com/MetaCubeX/mihomo", pinnedCommit: commit }, artifacts: records,
  }));
  return { fixture, repo, artifacts };
}

function runVerifier(fixture) {
  return spawnSync("python3", ["scripts/verify-mihomo-native-artifacts.py", "--artifacts-root", fixture.artifacts, "--repo-root", fixture.repo], { cwd: root, encoding: "utf8" });
}

test("library.go is a minimal standalone Go entry without flag, os, or CLI imports", () => {
  const source = read(libraryEntry).replace(/^\/\/.*$/gm, "").replace(/\n{2,}/g, "\n\n").trim();
  assert.equal(source, "package main\n\nfunc main() {}");
  assert.doesNotMatch(read(libraryEntry), /^\s*import\s*[\s\S]*$/m);
  assert.doesNotMatch(source, /(?:^|[\s"'])flag|(?:^|[\s"'])os|cobra|urfave|cli/i);
});

test("Android workflow stages and tests the dedicated library package", () => {
  const copy = step("Add AngelaNexus Android bridge");
  assert.match(copy.run, /cp .*mihomo-bridge\/library\.go" \.\/angelanexus_android\/library\.go/);
  assert.match(copy.run, /mkdir(?: -p)? \.\/angelanexus_android/);
  const host = step("Test bridge state against pinned Mihomo on host (not Android TUN)");
  assert.match(host.run, /trap 'cp .*bridge\.go" \.\/angelanexus_android\/bridge\.go' EXIT/);
  assert.match(host.run, /sed '1,2d' .*bridge\.go.*> \.\/angelanexus_android\/bridge\.go/);
  assert.match(host.run, /cp .*?(?:bridge_)?integration_test\.go" \.\/angelanexus_android\/(?:bridge_)?integration_test\.go/);
  assert.match(host.run, /cp .*library_integration_test\.go" \.\/angelanexus_android\/library_integration_test\.go/);
  assert.match(host.run, /go test -race -tags=with_gvisor,cmfa -run '\^TestAndroidBridge' -count=1 -timeout=90s -v \.\/angelanexus_android/);
  assert.match(host.run, /go build -trimpath -tags=with_gvisor,cmfa -buildmode=c-shared -o "\$RUNNER_TEMP\/libclash-host\.so" \.\/angelanexus_android/);
  assert.match(host.run, /timeout 30s python3 .*smoke-mihomo-library\.py.*"\$RUNNER_TEMP\/libclash-host\.so" --foreign-host-flag=library-smoke/);
  const build = step("Build native shared object");
  assert.match(build.run, /go build[\s\S]*-o[\s\S]*\.\/angelanexus_android/);
  assert.doesNotMatch(build.run, /-o[\\s\\S]*\n\s*\./);
  assert.ok(steps.indexOf(host) < steps.indexOf(build));
});

test("provenance records the dedicated package and library entry digest", () => {
  const provenance = step("Generate native build provenance evidence");
  assert.match(provenance.run, /sha256sum .*mihomo-bridge\/library\.go/);
  assert.match(provenance.run, /"package": "\.\/angelanexus_android"/);
  assert.match(provenance.run, /"libraryEntry": \{"path": "native\/android\/mihomo-bridge\/library\.go", "sha256": "\$LIBRARY_ENTRY_SHA256"\}/);
});

test("verifier validates build.package and libraryEntry instead of merely preserving them", () => {
  const source = read("scripts/verify-mihomo-native-artifacts.py");
  assert.match(source, /EXPECTED_(?:BUILD_)?PACKAGE\s*=\s*["']\.\/angelanexus_android["']/);
  assert.match(source, /libraryEntry/);
  assert.match(source, /build.*package|package.*build/s);
  const fixture = verifierFixture();
  try {
    assert.equal(runVerifier(fixture).status, 0, runVerifier(fixture).stderr);
    const provenancePath = join(fixture.artifacts, "arm64-v8a", "mihomo-provenance-arm64-v8a.json");
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    delete provenance.libraryEntry;
    writeFileSync(provenancePath, JSON.stringify(provenance));
    assert.notEqual(runVerifier(fixture).status, 0, "verifier must require libraryEntry");
    provenance.libraryEntry = { path: libraryEntry, sha256: digest(readFileSync(join(root, libraryEntry))) };
    provenance.build.package = ".";
    writeFileSync(provenancePath, JSON.stringify(provenance));
    assert.notEqual(runVerifier(fixture).status, 0, "verifier must reject a non-dedicated build package");
  } finally {
    rmSync(fixture.fixture, { recursive: true, force: true });
  }
});
