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
  const patchedDnsServer = Buffer.from("fixture patched DNS server\n");
  const patchedDnsDoH = Buffer.from("fixture patched DNS DoH\n");
  const patchedDnsClient = Buffer.from("fixture patched DNS client\n");
  const patchedDnsTLS = Buffer.from("fixture patched DNS TLS\n");
  const patchedDnsDHCP = Buffer.from("fixture patched DNS DHCP\n");
  const patchedDnsUtil = Buffer.from("fixture patched DNS util\n");
  const patchedDhcpDiscovery = Buffer.from("fixture patched DHCP discovery\n");
  const patchedNtpService = Buffer.from("fixture patched NTP service\n");
  const patchedSocks5 = Buffer.from("fixture patched SOCKS5 outbound\n");
  const patchedDnsOutbound = Buffer.from("fixture patched DNS outbound\n");
  const patchedProviderFetcher = Buffer.from("fixture patched provider fetcher\n");
  const patchedProviderHealthcheck = Buffer.from("fixture patched provider healthcheck\n");
  const patchedProxyProvider = Buffer.from("fixture patched proxy provider\n");
  const patchedLog = Buffer.from("fixture patched log source\n");
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
  writeFileSync(join(root, "dns/server.go"), patchedDnsServer);
  writeFileSync(join(root, "dns/doh.go"), patchedDnsDoH);
  writeFileSync(join(root, "dns/client.go"), patchedDnsClient);
  writeFileSync(join(root, "dns/dot.go"), patchedDnsTLS);
  writeFileSync(join(root, "dns/dhcp.go"), patchedDnsDHCP);
  writeFileSync(join(root, "dns/util.go"), patchedDnsUtil);
  mkdirSync(join(root, "component/dhcp"), { recursive: true });
  writeFileSync(join(root, "component/dhcp/dhcp.go"), patchedDhcpDiscovery);
  mkdirSync(join(root, "ntp/ntp"), { recursive: true });
  writeFileSync(join(root, "ntp/ntp/service.go"), patchedNtpService);
  mkdirSync(join(root, "component/resource"), { recursive: true });
  mkdirSync(join(root, "adapter/provider"), { recursive: true });
  mkdirSync(join(root, "adapter/outbound"), { recursive: true });
  writeFileSync(join(root, "adapter/provider/healthcheck.go"), patchedProviderHealthcheck);
  writeFileSync(join(root, "adapter/provider/provider.go"), patchedProxyProvider);
  writeFileSync(join(root, "adapter/outbound/socks5.go"), patchedSocks5);
  writeFileSync(join(root, "adapter/outbound/dns.go"), patchedDnsOutbound);
  writeFileSync(join(root, "component/resource/fetcher.go"), patchedProviderFetcher);
  mkdirSync(join(root, "log"), { recursive: true });
  writeFileSync(join(root, "log/log.go"), patchedLog);
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
  const adapterSource = `PATCHED_SERVER_SHA256 = "${digest(patchedSource)}"\nPATCHED_DNS_RESOLVER_SHA256 = "${digest(patchedDnsResolver)}"\nPATCHED_DNS_SERVER_SHA256 = "${digest(patchedDnsServer)}"\nPATCHED_DNS_DOH_SHA256 = "${digest(patchedDnsDoH)}"\nPATCHED_DNS_CLIENT_SHA256 = "${digest(patchedDnsClient)}"\nPATCHED_DNS_TLS_SHA256 = "${digest(patchedDnsTLS)}"\nPATCHED_DNS_DHCP_SHA256 = "${digest(patchedDnsDHCP)}"\nPATCHED_DNS_UTIL_SHA256 = "${digest(patchedDnsUtil)}"\nPATCHED_DHCP_DISCOVERY_SHA256 = "${digest(patchedDhcpDiscovery)}"\nPATCHED_NTP_SERVICE_SHA256 = "${digest(patchedNtpService)}"\nPATCHED_SOCKS5_SHA256 = "${digest(patchedSocks5)}"\nPATCHED_DNS_OUTBOUND_SHA256 = "${digest(patchedDnsOutbound)}"\nPATCHED_PROVIDER_FETCHER_SHA256 = "${digest(patchedProviderFetcher)}"\nPATCHED_PROVIDER_HEALTHCHECK_SHA256 = "${digest(patchedProviderHealthcheck)}"\nPATCHED_PROXY_PROVIDER_SHA256 = "${digest(patchedProxyProvider)}"\nPATCHED_STATISTICS_SHA256 = "${digest(patchedStatistics)}"\nSTATISTICS_PATCH_SHA256 = "${digest(statisticsPatch)}"\nLATE_CONNECTIONS_PATCH_SHA256 = "${digest(lateConnectionsPatch)}"\nPATCHED_LATE_MANAGER_SHA256 = "${digest(patchedStatistics)}"\nPATCHED_TRACKER_SHA256 = "${digest(patchedTracker)}"\nPATCHED_TUNNEL_SHA256 = "${digest(patchedTunnel)}"\nPATCHED_NAT_TABLE_SHA256 = "${digest(patchedNatTable)}"\nPATCHED_CONNECTION_SHA256 = "${digest(patchedConnection)}"\nPATCHED_QUIC_SNIFFER_SHA256 = "${digest(patchedQuicSniffer)}"\nPATCHED_TPROXY_PACKET_SHA256 = "${digest(patchedTproxyPacket)}"\nPATCHED_LOG_SHA256 = "${digest(patchedLog)}"\n`;
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
      dnsServer: { path: "dns/server.go", sha256: digest(patchedDnsServer) },
      dnsDoH: { path: "dns/doh.go", sha256: digest(patchedDnsDoH) },
      dnsClient: { path: "dns/client.go", sha256: digest(patchedDnsClient) },
      dnsTLS: { path: "dns/dot.go", sha256: digest(patchedDnsTLS) },
      dnsDHCP: { path: "dns/dhcp.go", sha256: digest(patchedDnsDHCP) },
      dnsUtil: { path: "dns/util.go", sha256: digest(patchedDnsUtil) },
      dhcpDiscovery: { path: "component/dhcp/dhcp.go", sha256: digest(patchedDhcpDiscovery) },
      ntpService: { path: "ntp/ntp/service.go", sha256: digest(patchedNtpService) },
      socks5Association: { path: "adapter/outbound/socks5.go", sha256: digest(patchedSocks5) },
      dnsOutbound: { path: "adapter/outbound/dns.go", sha256: digest(patchedDnsOutbound) },
      providerFetcher: { path: "component/resource/fetcher.go", sha256: digest(patchedProviderFetcher) },
      providerHealthCheck: { path: "adapter/provider/healthcheck.go", sha256: digest(patchedProviderHealthcheck) },
      proxyProvider: { path: "adapter/provider/provider.go", sha256: digest(patchedProxyProvider) },
      logSource: { path: "log/log.go", sha256: digest(patchedLog) },
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
          dnsDoH: { path: "dns/doh.go", sha256: digest(patchedDnsDoH) },
          dnsClient: { path: "dns/client.go", sha256: digest(patchedDnsClient) },
          dnsTLS: { path: "dns/dot.go", sha256: digest(patchedDnsTLS) },
          dnsDHCP: { path: "dns/dhcp.go", sha256: digest(patchedDnsDHCP) },
          dnsUtil: { path: "dns/util.go", sha256: digest(patchedDnsUtil) },
          dhcpDiscovery: { path: "component/dhcp/dhcp.go", sha256: digest(patchedDhcpDiscovery) },
          ntpService: { path: "ntp/ntp/service.go", sha256: digest(patchedNtpService) },
          socks5Association: { path: "adapter/outbound/socks5.go", sha256: digest(patchedSocks5) },
          dnsOutbound: { path: "adapter/outbound/dns.go", sha256: digest(patchedDnsOutbound) },
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

test("rejects missing, incorrect-path, and incorrect-hash DNS DoH provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.dnsDoH; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'dnsDoH'/);
  const fresh = fixture();
  try {
    mutate(fresh, "arm64-v8a", (p) => { p.dnsDoH.path = "dns/wrong.go"; });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsDoH path mismatch/);
    mutate(fresh, "arm64-v8a", (p) => { p.dnsDoH.path = "dns/doh.go"; p.dnsDoH.sha256 = "0".repeat(64); });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsDoH SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects missing, incorrect-path, and incorrect-hash DNS server provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.dnsServer; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'dnsServer'/);
  const fresh = fixture();
  try {
    mutate(fresh, "arm64-v8a", (p) => { p.dnsServer.path = "dns/wrong.go"; });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsServer path mismatch/);
    mutate(fresh, "arm64-v8a", (p) => { p.dnsServer.path = "dns/server.go"; p.dnsServer.sha256 = "0".repeat(64); });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsServer SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects evidence from tampered DNS server source and invalid adapter digest literals", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "dns/server.go"), "tampered DNS server\n");
  // Artifact verification consumes provenance, not an upstream worktree. The
  // source adapter independently rejects tampered inputs; emulate the evidence
  // a build of this wrong output would actually produce here.
  mutate(fx, "arm64-v8a", (p) => { p.dnsServer.sha256 = digest(readFileSync(join(fx.root, "dns/server.go"))); });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /dnsServer SHA-256 mismatch/);
  const cases = [
    ["PATCHED_DNS_SERVER_SHA256 = compute()", /PATCHED_DNS_SERVER_SHA256 must be a literal string/],
    ["", /exactly one PATCHED_DNS_SERVER_SHA256/],
    [`PATCHED_DNS_SERVER_SHA256 = "${"a".repeat(63)}"`, /PATCHED_DNS_SERVER_SHA256 must be a 64-character SHA-256 hex string/],
    [`PATCHED_DNS_SERVER_SHA256 = "${"a".repeat(64)}"\nPATCHED_DNS_SERVER_SHA256 = "${"b".repeat(64)}"`, /exactly one PATCHED_DNS_SERVER_SHA256/],
  ];
  for (const [replacement, expected] of cases) {
    const fresh = fixture();
    try {
      const path = join(fresh.root, "native/android/mihomo-bridge/prepare-upstream.py");
      const original = readFileSync(path, "utf8");
      writeFileSync(path, original.replace(/PATCHED_DNS_SERVER_SHA256 = "[0-9a-f]+"\n?/, `${replacement}\n`));
      result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, expected);
    } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  }
}));

test("rejects missing, non-literal, malformed and duplicate DoH digest constants", () => {
  const cases = [
    ["", /exactly one PATCHED_DNS_DOH_SHA256/],
    ["PATCHED_DNS_DOH_SHA256 = compute()", /PATCHED_DNS_DOH_SHA256 must be a literal string/],
    [`PATCHED_DNS_DOH_SHA256 = "${"a".repeat(63)}"`, /PATCHED_DNS_DOH_SHA256 must be a 64-character SHA-256 hex string/],
    [`PATCHED_DNS_DOH_SHA256 = "${"a".repeat(64)}"\nPATCHED_DNS_DOH_SHA256 = "${"b".repeat(64)}"`, /exactly one PATCHED_DNS_DOH_SHA256/],
  ];
  for (const [replacement, expected] of cases) {
    withFixture(fx => {
      const path = join(fx.root, "native/android/mihomo-bridge/prepare-upstream.py");
      const original = readFileSync(path, "utf8");
      writeFileSync(path, original.replace(/PATCHED_DNS_DOH_SHA256 = "[0-9a-f]+"\n?/, `${replacement}\n`));
      const result = run(fx);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected);
    });
  }
});

test("rejects provenance produced from tampered DoH output", () => withFixture(fx => {
  const source = join(fx.root, "dns/doh.go");
  writeFileSync(source, "tampered DoH transport\n");
  mutate(fx, "x86_64", p => { p.dnsDoH.sha256 = digest(readFileSync(source)); });
  const result = run(fx);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dnsDoH SHA-256 mismatch/);
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

test("rejects missing, incorrect-path, incorrect-hash, and tampered DHCP discovery provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.dhcpDiscovery; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'dhcpDiscovery'/);
  const cases = [
    p => { p.dhcpDiscovery.path = "dns/dhcp.go"; },
    p => { p.dhcpDiscovery.sha256 = "0".repeat(64); },
    p => { p.lateConnectionsPatch.patchedSources.dhcpDiscovery.path = "dns/dhcp.go"; },
    p => { p.lateConnectionsPatch.patchedSources.dhcpDiscovery.sha256 = "0".repeat(64); },
  ];
  for (const edit of cases) {
    const fresh = fixture(); try {
      mutate(fresh, "arm64-v8a", edit); result = run(fresh); assert.notEqual(result.status, 0);
      assert.match(result.stderr, /dhcpDiscovery (?:path|SHA-256) mismatch/);
    } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  }
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

test("rejects missing, path, and hash SOCKS5 association provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.socks5Association; });
  let result = run(fx); assert.equal(result.status, 1); assert.match(result.stderr, /missing required field 'socks5Association'/);
  const fresh = fixture(); try {
    mutate(fresh, "x86_64", (p) => { p.socks5Association.path = "adapter/outbound/wrong.go"; });
    result = run(fresh); assert.equal(result.status, 1); assert.match(result.stderr, /socks5Association path mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  const hashed = fixture(); try {
    mutate(hashed, "x86_64", (p) => { p.socks5Association.sha256 = "0".repeat(64); });
    result = run(hashed); assert.equal(result.status, 1); assert.match(result.stderr, /socks5Association SHA-256 mismatch/);
  } finally { rmSync(hashed.root, { recursive: true, force: true }); }
  const nested = fixture(); try {
    mutate(nested, "x86_64", (p) => { delete p.lateConnectionsPatch.patchedSources.socks5Association; });
    result = run(nested); assert.equal(result.status, 1); assert.match(result.stderr, /missing required field 'socks5Association'/);
  } finally { rmSync(nested.root, { recursive: true, force: true }); }
}));

test("rejects invalid or missing SOCKS5 adapter hash constant", () => withFixture((fx) => {
  const path = join(fx.root, "native/android/mihomo-bridge/prepare-upstream.py");
  const original = readFileSync(path, "utf8");
  for (const [replacement, expected] of [["", /exactly one PATCHED_SOCKS5_SHA256/], ["PATCHED_SOCKS5_SHA256 = compute()", /PATCHED_SOCKS5_SHA256 must be a literal string/]]) {
    writeFileSync(path, original.replace(/PATCHED_SOCKS5_SHA256 = "[0-9a-f]+"\n?/, replacement + "\n"));
    const result = run(fx); assert.equal(result.status, 1); assert.match(result.stderr, expected);
    writeFileSync(path, original);
  }
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

test("provider and log source directories may be absent from the packaging checkout", () => withFixture((fx) => {
  rmSync(join(fx.root, "adapter/provider"), { recursive: true });
  rmSync(join(fx.root, "log"), { recursive: true });
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

test("rejects missing, incorrect-path, and incorrect-hash logSource provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.logSource; });
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /missing required field 'logSource'/);
  const fresh = fixture();
  try {
    mutate(fresh, "arm64-v8a", (p) => { p.logSource.path = "log/wrong.go"; });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /logSource path mismatch/);
    mutate(fresh, "arm64-v8a", (p) => { p.logSource.path = "log/log.go"; p.logSource.sha256 = "0".repeat(64); });
    result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, /logSource SHA-256 mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
}));

test("rejects tampered log source and duplicate/missing/invalid adapter log hash literals", () => withFixture((fx) => {
  writeFileSync(join(fx.root, "log/log.go"), "tampered log source\n");
  let result = run(fx); assert.notEqual(result.status, 0); assert.match(result.stderr, /logSource SHA-256 mismatch/);
  const cases = [
    ["PATCHED_LOG_SHA256 = compute()", /PATCHED_LOG_SHA256 must be a literal string/],
    ["", /exactly one PATCHED_LOG_SHA256/],
    [`PATCHED_LOG_SHA256 = "${"a".repeat(64)}"\nPATCHED_LOG_SHA256 = "${"b".repeat(64)}"`, /exactly one PATCHED_LOG_SHA256/],
  ];
  for (const [replacement, expected] of cases) {
    const fresh = fixture();
    try {
      const path = join(fresh.root, "native/android/mihomo-bridge/prepare-upstream.py");
      const original = readFileSync(path, "utf8");
      writeFileSync(path, original.replace(/PATCHED_LOG_SHA256 = "[0-9a-f]+"\n?/, replacement));
      result = run(fresh); assert.notEqual(result.status, 0); assert.match(result.stderr, expected);
    } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  }
}));


test("rejects provider healthcheck/proxy provenance omission, path, hash, and nonliteral adapter constants", () => withFixture((fx) => {
  const constants = {
    providerHealthCheck: "PATCHED_PROVIDER_HEALTHCHECK_SHA256",
    proxyProvider: "PATCHED_PROXY_PROVIDER_SHA256",
  };
  for (const [field, constant] of Object.entries(constants)) {
    for (const abi of ABIS) {
      const missing = fixture(); try { mutate(missing, abi, (p) => { delete p[field]; }); const r = run(missing); assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`missing required field '${field}'`)); } finally { rmSync(missing.root, { recursive: true, force: true }); }
      const pathFx = fixture(); try { mutate(pathFx, abi, (p) => { p[field].path = "tampered.go"; }); const r = run(pathFx); assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`${field} path mismatch`)); } finally { rmSync(pathFx.root, { recursive: true, force: true }); }
      const hashFx = fixture(); try { mutate(hashFx, abi, (p) => { p[field].sha256 = "0".repeat(64); }); const r = run(hashFx); assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`${field} SHA-256 mismatch`)); } finally { rmSync(hashFx.root, { recursive: true, force: true }); }
    }
    for (const [replacement, expected] of [
      [`${constant} = str("literal")`, new RegExp(`upstream adapter ${constant} must be a literal string`)],
      ["", new RegExp(`exactly one ${constant} constant`)],
      [`${constant} = "${"a".repeat(63)}"`, new RegExp(`${constant} must be a 64-character SHA-256 hex string`)],
      [`${constant} = "${"a".repeat(64)}"\n${constant} = "${"b".repeat(64)}"`, new RegExp(`exactly one ${constant} constant`)],
    ]) {
      const constantFx = fixture();
      try {
        const path = join(constantFx.root, "native/android/mihomo-bridge/prepare-upstream.py");
        const original = readFileSync(path, "utf8");
        writeFileSync(path, original.replace(new RegExp(`${constant} = "[0-9a-f]+"\n?`), () => replacement + "\n"));
        const r = run(constantFx); assert.equal(r.status, 1); assert.match(r.stderr, expected);
      } finally { rmSync(constantFx.root, { recursive: true, force: true }); }
    }
  }
}));

for (const [field, relative] of [["providerHealthCheck", "adapter/provider/healthcheck.go"], ["proxyProvider", "adapter/provider/provider.go"]]) {
  test(`rejects changed ${field} source when the upstream checkout is present`, () => withFixture((fx) => {
    writeFileSync(join(fx.root, relative), "tampered reviewed source\n");
    const result = run(fx);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`${field} SHA-256 mismatch: checkout source differs`));
  }));
}

for (const [name, source, constant] of [
  ["dnsClient", "dns/client.go", "PATCHED_DNS_CLIENT_SHA256"],
  ["dnsTLS", "dns/dot.go", "PATCHED_DNS_TLS_SHA256"],
  ["dnsDHCP", "dns/dhcp.go", "PATCHED_DNS_DHCP_SHA256"],
  ["dnsUtil", "dns/util.go", "PATCHED_DNS_UTIL_SHA256"],
  ["dhcpDiscovery", "component/dhcp/dhcp.go", "PATCHED_DHCP_DISCOVERY_SHA256"],
  ["dnsOutbound", "adapter/outbound/dns.go", "PATCHED_DNS_OUTBOUND_SHA256"],
]) {
  test(`rejects missing, expression, malformed and duplicate ${constant} constants`, () => {
    for (const [replacement, reason] of [
      ["", `exactly one ${constant}`],
      [`${constant} = compute()`, `${constant} must be a literal string`],
      [`${constant} = "${"a".repeat(63)}"`, `${constant} must be a 64-character SHA-256 hex string`],
      [`${constant} = "${"a".repeat(64)}"\n${constant} = "${"b".repeat(64)}"`, `exactly one ${constant}`],
    ]) withFixture(fx => {
      const path = join(fx.root, "native/android/mihomo-bridge/prepare-upstream.py");
      const original = readFileSync(path, "utf8");
      const pattern = new RegExp(`${constant} = "[0-9a-f]+"\\n?`);
      assert.match(original, pattern);
      writeFileSync(path, original.replace(pattern, `${replacement}\n`));
      const result = run(fx);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(reason), result.stderr);
    });
  });
  for (const fault of ["top-missing", "top-path", "top-hash", "nested-missing", "nested-path", "nested-hash", "tampered-output"]) {
    test(`rejects ${name} provenance: ${fault}`, () => withFixture(fx => {
      if (fault === "tampered-output") writeFileSync(join(fx.root, source), "unreviewed resolver generation output\n");
      mutate(fx, "x86_64", p => {
        const nested = p.lateConnectionsPatch.patchedSources;
        if (fault === "top-missing") delete p[name];
        if (fault === "top-path") p[name].path = "unreviewed.go";
        if (fault === "top-hash") p[name].sha256 = "0".repeat(64);
        if (fault === "nested-missing") delete nested[name];
        if (fault === "nested-path") nested[name].path = "unreviewed.go";
        if (fault === "nested-hash") nested[name].sha256 = "0".repeat(64);
        if (fault === "tampered-output") p[name].sha256 = nested[name].sha256 = digest(readFileSync(join(fx.root, source)));
      });
      const result = run(fx);
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(name), result.stderr);
      assert.doesNotMatch(result.stderr, /Traceback/);
    }));
  }
}

test("rejects missing, path, and hash DNS outbound provenance", () => withFixture((fx) => {
  mutate(fx, "arm64-v8a", (p) => { delete p.dnsOutbound; });
  let result = run(fx); assert.equal(result.status, 1); assert.match(result.stderr, /missing required field 'dnsOutbound'/);
  const fresh = fixture(); try {
    mutate(fresh, "x86_64", (p) => { p.dnsOutbound.path = "adapter/outbound/wrong.go"; });
    result = run(fresh); assert.equal(result.status, 1); assert.match(result.stderr, /dnsOutbound path mismatch/);
  } finally { rmSync(fresh.root, { recursive: true, force: true }); }
  const hashed = fixture(); try {
    mutate(hashed, "x86_64", (p) => { p.dnsOutbound.sha256 = "0".repeat(64); });
    result = run(hashed); assert.equal(result.status, 1); assert.match(result.stderr, /dnsOutbound SHA-256 mismatch/);
  } finally { rmSync(hashed.root, { recursive: true, force: true }); }
  const nested = fixture(); try {
    mutate(nested, "x86_64", (p) => { delete p.lateConnectionsPatch.patchedSources.dnsOutbound; });
    result = run(nested); assert.equal(result.status, 1); assert.match(result.stderr, /missing required field 'dnsOutbound'/);
  } finally { rmSync(nested.root, { recursive: true, force: true }); }
}));

test("rejects invalid or missing DNS outbound adapter hash constant", () => withFixture((fx) => {
  const path = join(fx.root, "native/android/mihomo-bridge/prepare-upstream.py");
  const original = readFileSync(path, "utf8");
  for (const [replacement, expected] of [["", /exactly one PATCHED_DNS_OUTBOUND_SHA256/], ["PATCHED_DNS_OUTBOUND_SHA256 = compute()", /PATCHED_DNS_OUTBOUND_SHA256 must be a literal string/]]) {
    writeFileSync(path, original.replace(/PATCHED_DNS_OUTBOUND_SHA256 = "[0-9a-f]+"\n?/, replacement + "\n"));
    const result = run(fx); assert.equal(result.status, 1); assert.match(result.stderr, expected);
    writeFileSync(path, original);
  }
}));
