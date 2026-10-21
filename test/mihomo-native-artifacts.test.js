import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64"];
const COMMIT = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36";
const PATCHED_TPROXY_PACKET_SHA256 = "f417e4776d8dcdeb97b194fff2de83b76f3cf8e181ae01ee3fc15218fb376c5f";
const REPOSITORY = "https://github.com/MetaCubeX/mihomo";
const verifier = join(process.cwd(), "scripts/verify-mihomo-native-artifacts.py");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mihomo-verifier-"));
  const artifacts = join(root, "artifacts");
  const bridge = Buffer.from("fixture bridge\n");
  const lifecycle = Buffer.from("fixture lifecycle\n");
  const libraryEntry = Buffer.from("package main\nfunc main() {}\n");
  const patchedSource = Buffer.from("fixture patched server\n");
  const patchedDnsResolver = Buffer.from("fixture patched DNS resolver\n");
  const patchedProviderFetcher = Buffer.from("fixture patched provider fetcher\n");
  const statisticsPatch = Buffer.from("fixture statistics patch\n");
  const patchedStatistics = Buffer.from("fixture patched statistics manager\n");
  const patchedTracker = Buffer.from("fixture patched tracker\n");
  const patchedTunnel = Buffer.from("fixture patched tunnel\n");
  const patchedNatTable = Buffer.from("fixture patched NAT table\n");
  const patchedConnection = Buffer.from("fixture patched connection\n");
  const patchedQuicSniffer = Buffer.from("fixture patched QUIC sniffer\n");
  const patchedTproxyPacket = Buffer.from("fixture patched TProxy packet\n");
  const lateConnectionsPatch = Buffer.from("fixture late connections patch\n");
  const sourceDir = join(root, "native/android/mihomo-bridge");
  mkdirSync(join(root, "dns"), { recursive: true });
  writeFileSync(join(root, "dns/resolver.go"), patchedDnsResolver);
  mkdirSync(join(root, "component/resource"), { recursive: true });
  writeFileSync(join(root, "component/resource/fetcher.go"), patchedProviderFetcher);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(join(root, "tunnel/statistic"), { recursive: true });
  mkdirSync(join(root, "listener/sing_tun"), { recursive: true });
  mkdirSync(join(root, "listener/tproxy"), { recursive: true });
  writeFileSync(join(root, "listener/sing_tun/server.go"), patchedSource);
  writeFileSync(join(root, "listener/tproxy/packet.go"), patchedTproxyPacket);
  writeFileSync(join(root, "tunnel/statistic/manager.go"), patchedStatistics);
  writeFileSync(join(root, "tunnel/statistic/tracker.go"), patchedTracker);
  writeFileSync(join(root, "tunnel/tunnel.go"), patchedTunnel);
  writeFileSync(join(sourceDir, "statistics.patch"), statisticsPatch);
  writeFileSync(join(sourceDir, "late-connections.patch"), lateConnectionsPatch);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "bridge.go"), bridge);
  writeFileSync(join(sourceDir, "lifecycle.go"), lifecycle);
  writeFileSync(join(sourceDir, "library.go"), libraryEntry);
  const adapterSource = `PATCHED_SERVER_SHA256 = "${digest(patchedSource)}"\nPATCHED_DNS_RESOLVER_SHA256 = "${digest(patchedDnsResolver)}"\nPATCHED_PROVIDER_FETCHER_SHA256 = "${digest(patchedProviderFetcher)}"\nPATCHED_STATISTICS_SHA256 = "${digest(patchedStatistics)}"\nSTATISTICS_PATCH_SHA256 = "${digest(statisticsPatch)}"\nLATE_CONNECTIONS_PATCH_SHA256 = "${digest(lateConnectionsPatch)}"\nPATCHED_LATE_MANAGER_SHA256 = "${digest(patchedStatistics)}"\nPATCHED_TRACKER_SHA256 = "${digest(patchedTracker)}"\nPATCHED_TUNNEL_SHA256 = "${digest(patchedTunnel)}"\nPATCHED_NAT_TABLE_SHA256 = "${digest(patchedNatTable)}"\nPATCHED_CONNECTION_SHA256 = "${digest(patchedConnection)}"\nPATCHED_QUIC_SNIFFER_SHA256 = "${digest(patchedQuicSniffer)}"\nPATCHED_TPROXY_PACKET_SHA256 = "${digest(patchedTproxyPacket)}"\n`;
  writeFileSync(join(sourceDir, "prepare-upstream.py"), adapterSource);
  const adapterSha = digest(adapterSource);
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
 const val PATCHED_TPROXY_PACKET_SHA256 = "${digest(patchedTproxyPacket)}"
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
      build: { trimpath: true, buildmode: "c-shared", package: "./angelanexus_android", tags: ["with_gvisor", "cmfa"], versionLdflag: "github.com/metacubex/mihomo/constant.Version=v1.19.32" },
      bridge: { path: "native/android/mihomo-bridge/bridge.go", sha256: digest(bridge) },
      lifecycle: { path: "native/android/mihomo-bridge/lifecycle.go", sha256: digest(lifecycle) },
      libraryEntry: { path: "native/android/mihomo-bridge/library.go", sha256: digest(libraryEntry) },
      dnsResolver: { path: "dns/resolver.go", sha256: digest(patchedDnsResolver) },
      providerFetcher: { path: "component/resource/fetcher.go", sha256: digest(patchedProviderFetcher) },
      ownershipAdapter: {
        path: "native/android/mihomo-bridge/prepare-upstream.py",
        sha256: adapterSha,
        patchedSource: { path: "listener/sing_tun/server.go", sha256: digest(patchedSource) },
      },
      statisticsPatch: {
        path: "native/android/mihomo-bridge/statistics.patch",
        sha256: digest(statisticsPatch),
        patchedSource: { path: "tunnel/statistic/manager.go", sha256: digest(patchedStatistics) },
      },
      lateConnectionsPatch: {
        path: "native/android/mihomo-bridge/late-connections.patch",
        sha256: digest(lateConnectionsPatch),
        patchedSources: {
          manager: { path: "tunnel/statistic/manager.go", sha256: digest(patchedStatistics) },
          tracker: { path: "tunnel/statistic/tracker.go", sha256: digest(patchedTracker) },
          tunnel: { path: "tunnel/tunnel.go", sha256: digest(patchedTunnel) },
          natTable: { path: "component/nat/table.go", sha256: digest(patchedNatTable) },
          connection: { path: "tunnel/connection.go", sha256: digest(patchedConnection) },
          quicSniffer: { path: "component/sniffer/quic_sniffer.go", sha256: digest(patchedQuicSniffer) },
          tproxyPacket: { path: "listener/tproxy/packet.go", sha256: digest(patchedTproxyPacket) },
        },
      },
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

test("rejects missing or incorrect DNS resolver provenance evidence", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.dnsResolver; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'dnsResolver'/);
  const fresh = fixture();
  try {
    mutate(fresh, "arm64-v8a", (p) => { p.dnsResolver.path = "dns/wrong.go"; });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsResolver path mismatch/);
    mutate(fresh, "arm64-v8a", (p) => { p.dnsResolver.path = "dns/resolver.go"; p.dnsResolver.sha256 = "0".repeat(64); });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsResolver SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects missing, incorrect-path, and incorrect-hash provider fetcher provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.providerFetcher; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'providerFetcher'/);
  const fresh = fixture();
  try {
    mutate(fresh, "arm64-v8a", (p) => { p.providerFetcher.path = "component/resource/wrong.go"; });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /providerFetcher path mismatch/);
    mutate(fresh, "arm64-v8a", (p) => { p.providerFetcher.path = "component/resource/fetcher.go"; p.providerFetcher.sha256 = "0".repeat(64); });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /providerFetcher SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
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

for (const target of [".", "./other", undefined]) {
  test(`rejects CLI, alternate or missing library package: ${target}`, () => withFixture((fx) => {
    mutate(fx, "arm64-v8a", (p) => { p.build.package = target; });
    const result = run(fx);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /library package mismatch|missing required field 'package'/);
  }));
}

test("rejects missing library entry evidence from older native builds", () => withFixture((fx) => {
  mutate(fx, "x86_64", (p) => { delete p.libraryEntry; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required field 'libraryEntry'/);
}));

test("rejects changed library entry source", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "native/android/mihomo-bridge/library.go"), "changed");
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /libraryEntry source digest mismatch/);
}));

test("rejects alternate library entry evidence path", () => withFixture((fx) => {
  mutate(fx, "armeabi-v7a", (p) => { p.libraryEntry.path = "main.go"; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /libraryEntry path mismatch/);
}));

test("rejects missing ownership adapter provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.ownershipAdapter; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required field 'ownershipAdapter'/);
}));

test("rejects ownership adapter path and hash tampering", () => withFixture((fx) => {
  mutate(fx, "armeabi-v7a", (p) => { p.ownershipAdapter.path = "prepare-upstream.py"; });
  const pathMismatch = run(fx);
  assert.equal(pathMismatch.status, 1);
  assert.match(pathMismatch.stderr, /ownershipAdapter path mismatch/);

  const fresh = fixture();
  try {
    mutate(fresh, "x86_64", (p) => { p.ownershipAdapter.sha256 = "0".repeat(64); });
    const hashMismatch = run(fresh);
    assert.equal(hashMismatch.status, 1);
    assert.match(hashMismatch.stderr, /ownershipAdapter SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects patched source path and hash tampering", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { p.ownershipAdapter.patchedSource.path = "listener/server.go"; });
  const pathMismatch = run(fx);
  assert.equal(pathMismatch.status, 1);
  assert.match(pathMismatch.stderr, /patchedSource path mismatch/);

  const fresh = fixture();
  try {
    mutate(fresh, "x86_64", (p) => { p.ownershipAdapter.patchedSource.sha256 = "f".repeat(64); });
    const hashMismatch = run(fresh);
    assert.equal(hashMismatch.status, 1);
    assert.match(hashMismatch.stderr, /patchedSource SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));


test("rejects missing statistics provenance from older native builds", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.statisticsPatch; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required field 'statisticsPatch'/);
}));

test("rejects statistics provenance path/hash tampering", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { p.statisticsPatch.path = "statistics.patch"; });
  const pathResult = run(fx);
  assert.equal(pathResult.status, 1);
  assert.match(pathResult.stderr, /statisticsPatch path mismatch/);
  const fresh = fixture();
  try {
    mutate(fresh, "x86_64", (p) => { p.statisticsPatch.patchedSource.sha256 = "0".repeat(64); });
    const hashResult = run(fresh);
    assert.equal(hashResult.status, 1);
    assert.match(hashResult.stderr, /statistics patchedSource SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects checkout statistics patch tampering", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "native/android/mihomo-bridge/statistics.patch"), "tampered");
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /statistics patch SHA-256 mismatch/);
}));

test("rejects old provenance without late-connections evidence", () => withFixture((fx) => {
  mutate(fx, "x86_64", (p) => { delete p.lateConnectionsPatch; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required field 'lateConnectionsPatch'/);
}));
test("rejects late patch and each final source hash tampering", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "native/android/mihomo-bridge/late-connections.patch"), "tampered");
  let result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /late connections patch SHA-256 mismatch/);
  const cases = [["manager", "manager.go"], ["tracker", "tracker.go"], ["tunnel", "tunnel.go"], ["natTable", "table.go"], ["connection", "connection.go"], ["quicSniffer", "quic_sniffer.go"]];
  for (const [name, file] of cases) {
    const fresh = fixture();
    try {
      mutate(fresh, "x86_64", (p) => { p.lateConnectionsPatch.patchedSources[name].sha256 = "0".repeat(64); });
      result = run(fresh);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`lateConnectionsPatch ${name} SHA-256 mismatch`));
    } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  }
}));
test("rejects late source path substitution", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { p.lateConnectionsPatch.patchedSources.tracker.path = "wrong.go"; });
  const result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lateConnectionsPatch tracker path mismatch/);
}));
test("rejects invalid or missing statistics adapter constants", () => withFixture((fx) => {
  const path = join(fx.root, "native/android/mihomo-bridge/prepare-upstream.py");
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace(/STATISTICS_PATCH_SHA256 = "[0-9a-f]+"/, "STATISTICS_PATCH_SHA256 = compute()"));
  let result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STATISTICS_PATCH_SHA256 must be a literal string/);
  writeFileSync(path, original.replace(/\nPATCHED_STATISTICS_SHA256[^\n]*/, ""));
  result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exactly one PATCHED_STATISTICS_SHA256/);
  writeFileSync(path, original + "LATE_CONNECTIONS_PATCH_SHA256 = compute()\n");
  result = run(fx);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LATE_CONNECTIONS_PATCH_SHA256 must be a literal string/);
}));

// Packaging runs in the application checkout, while the reviewed upstream
// source exists only in the native build job. Known output digests in the
// adapter and the downloaded provenance are the bridge between those jobs.
test("packaging does not require an upstream source checkout in the app repository", () => withFixture((fx) => {
  rmSync(join(fx.root, "tunnel"), { recursive: true });
  rmSync(join(fx.root, "listener"), { recursive: true });
  const result = run(fx);
  assert.equal(result.status, 0, result.stderr);
}));

test("rejects TProxy packet provenance tampering", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => {
    p.lateConnectionsPatch.patchedSources.tproxyPacket.sha256 = "0".repeat(64);
  });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tproxyPacket SHA-256 mismatch/);
}));
for (const name of ["natTable", "connection", "quicSniffer"]) {
  test(`rejects old provenance missing ${name} output evidence`, () => withFixture((fx) => {
    mutate(fx, "x86_64", (p) => { delete p.lateConnectionsPatch.patchedSources[name]; });
    const result = run(fx);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`missing required field '${name}'`));
  }));
  test(`rejects alternate ${name} output path`, () => withFixture((fx) => {
    mutate(fx, "arm64-v8a", (p) => { p.lateConnectionsPatch.patchedSources[name].path = "wrong.go"; });
    const result = run(fx);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`lateConnectionsPatch ${name} path mismatch`));
  }));
}
