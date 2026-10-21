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
  const patchedDnsResolverHash = digest("fixture patched DNS resolver");
  const patchedDnsServerHash = digest("fixture patched DNS server");
  const patchedDnsDoHHash = digest("fixture patched DoH source");
  const patchedDnsClientHash = digest("fixture patched DNS client");
  const patchedDnsTLSHash = digest("fixture patched DNS TLS");
  const patchedDnsDHCPHash = digest("fixture patched DNS DHCP");
  const patchedDnsUtilHash = digest("fixture patched DNS util");
  const patchedDhcpDiscoveryHash = digest("fixture patched DHCP discovery");
  const patchedProviderFetcherHash = digest("fixture patched provider fetcher");
  const patchedProviderHealthcheckHash = digest("fixture patched provider healthcheck");
  const patchedProxyProviderHash = digest("fixture patched proxy provider");
  const patchedLogHash = digest("fixture patched log source");
  const patchedStatistics = "fixture patched statistics";
  const patchedStatisticsHash = digest(patchedStatistics);
  const patchedTracker = "fixture patched tracker";
  const patchedTrackerHash = digest(patchedTracker);
  const patchedTunnel = "fixture patched tunnel";
  const patchedTunnelHash = digest(patchedTunnel);
  const patchedNatTableHash = digest("fixture NAT table");
  const patchedConnectionHash = digest("fixture UDP connection");
  const patchedQuicSnifferHash = digest("fixture QUIC sniffer");
  const patchedTproxyPacketHash = digest("fixture TProxy packet");
  const patchedNtpService = "fixture patched NTP service";
  const patchedNtpServiceHash = digest(patchedNtpService);
  const patchedSocks5Association = "fixture patched SOCKS5 association";
  const patchedSocks5AssociationHash = digest(patchedSocks5Association);
  const statisticsPatch = "fixture statistics patch\n";
  const lateConnectionsPatch = "fixture late connections patch\n";
  mkdirSync(join(repo, "tunnel/statistic"), { recursive: true });
  mkdirSync(join(repo, "dns"), { recursive: true });
  mkdirSync(join(repo, "ntp/ntp"), { recursive: true });
  mkdirSync(join(repo, "adapter/outbound"), { recursive: true });
  writeFileSync(join(repo, "dns/resolver.go"), "fixture patched DNS resolver");
  writeFileSync(join(repo, "dns/doh.go"), "fixture patched DoH source");
  writeFileSync(join(repo, "dns/client.go"), "fixture patched DNS client");
  writeFileSync(join(repo, "dns/dot.go"), "fixture patched DNS TLS");
  writeFileSync(join(repo, "dns/dhcp.go"), "fixture patched DNS DHCP");
  writeFileSync(join(repo, "dns/util.go"), "fixture patched DNS util");
  writeFileSync(join(repo, "ntp/ntp/service.go"), patchedNtpService);
  writeFileSync(join(repo, "adapter/outbound/socks5.go"), patchedSocks5Association);
  mkdirSync(join(repo, "component/dhcp"), { recursive: true });
  writeFileSync(join(repo, "component/dhcp/dhcp.go"), "fixture patched DHCP discovery");
  mkdirSync(join(repo, "component/resource"), { recursive: true });
  writeFileSync(join(repo, "component/resource/fetcher.go"), "fixture patched provider fetcher");
  mkdirSync(join(repo, "log"), { recursive: true });
  writeFileSync(join(repo, "log/log.go"), "fixture patched log source");
  writeFileSync(join(repo, "tunnel/statistic/manager.go"), patchedStatistics);
  writeFileSync(join(repo, "tunnel/statistic/tracker.go"), patchedTracker);
  writeFileSync(join(repo, "tunnel/tunnel.go"), patchedTunnel);
  writeFileSync(join(sourceDir, "statistics.patch"), statisticsPatch);
  writeFileSync(join(sourceDir, "late-connections.patch"), lateConnectionsPatch);
  writeFileSync(join(sourceDir, "prepare-upstream.py"), `PATCHED_SERVER_SHA256 = "${patchedSourceHash}"\nPATCHED_DNS_RESOLVER_SHA256 = "${patchedDnsResolverHash}"\nPATCHED_DNS_SERVER_SHA256 = "${patchedDnsServerHash}"\nPATCHED_DNS_DOH_SHA256 = "${patchedDnsDoHHash}"\nPATCHED_DNS_CLIENT_SHA256 = "${patchedDnsClientHash}"\nPATCHED_DNS_TLS_SHA256 = "${patchedDnsTLSHash}"\nPATCHED_DNS_DHCP_SHA256 = "${patchedDnsDHCPHash}"\nPATCHED_DNS_UTIL_SHA256 = "${patchedDnsUtilHash}"\nPATCHED_DHCP_DISCOVERY_SHA256 = "${patchedDhcpDiscoveryHash}"\nPATCHED_PROVIDER_FETCHER_SHA256 = "${patchedProviderFetcherHash}"\nPATCHED_PROVIDER_HEALTHCHECK_SHA256 = "${patchedProviderHealthcheckHash}"\nPATCHED_PROXY_PROVIDER_SHA256 = "${patchedProxyProviderHash}"\nPATCHED_STATISTICS_SHA256 = "${patchedStatisticsHash}"\nSTATISTICS_PATCH_SHA256 = "${digest(statisticsPatch)}"\nLATE_CONNECTIONS_PATCH_SHA256 = "${digest(lateConnectionsPatch)}"\nPATCHED_LATE_MANAGER_SHA256 = "${patchedStatisticsHash}"\nPATCHED_TRACKER_SHA256 = "${patchedTrackerHash}"\nPATCHED_TUNNEL_SHA256 = "${patchedTunnelHash}"\nPATCHED_NAT_TABLE_SHA256 = "${patchedNatTableHash}"\nPATCHED_CONNECTION_SHA256 = "${patchedConnectionHash}"\nPATCHED_QUIC_SNIFFER_SHA256 = "${patchedQuicSnifferHash}"\nPATCHED_TPROXY_PACKET_SHA256 = "${patchedTproxyPacketHash}"\nPATCHED_LOG_SHA256 = "${patchedLogHash}"\nPATCHED_NTP_SERVICE_SHA256 = "${patchedNtpServiceHash}"\nPATCHED_SOCKS5_SHA256 = "${patchedSocks5AssociationHash}"\n`);
  const abis = ["arm64-v8a", "armeabi-v7a", "x86_64"];
  const commit = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36";
  const specs = abis.map(abi => `MihomoNativeLibrarySpec(abi = "${abi}", sha256 = "${"a".repeat(64)}")`).join(",\n");
  writeFileSync(join(repo, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"),
    `const val VERSION = "v1.19.32"\nconst val SOURCE_COMMIT = "${commit}"\nconst val PATCHED_TPROXY_PACKET_SHA256 = "${patchedTproxyPacketHash}"\n${specs}\n`);
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
      dnsResolver: { path: "dns/resolver.go", sha256: patchedDnsResolverHash },
      dhcpDiscovery: { path: "component/dhcp/dhcp.go", sha256: patchedDhcpDiscoveryHash },
      dnsServer: { path: "dns/server.go", sha256: patchedDnsServerHash },
      dnsDoH: { path: "dns/doh.go", sha256: patchedDnsDoHHash },
      dnsClient: { path: "dns/client.go", sha256: patchedDnsClientHash }, dnsTLS: { path: "dns/dot.go", sha256: patchedDnsTLSHash }, dnsDHCP: { path: "dns/dhcp.go", sha256: patchedDnsDHCPHash }, dnsUtil: { path: "dns/util.go", sha256: patchedDnsUtilHash },
      providerFetcher: { path: "component/resource/fetcher.go", sha256: patchedProviderFetcherHash },
      providerHealthCheck: { path: "adapter/provider/healthcheck.go", sha256: patchedProviderHealthcheckHash },
      proxyProvider: { path: "adapter/provider/provider.go", sha256: patchedProxyProviderHash },
      logSource: { path: "log/log.go", sha256: patchedLogHash },
      ntpService: { path: "ntp/ntp/service.go", sha256: patchedNtpServiceHash },
      socks5Association: { path: "adapter/outbound/socks5.go", sha256: patchedSocks5AssociationHash },
      ownershipAdapter: { ...evidence("prepare-upstream.py"), patchedSource: { path: "listener/sing_tun/server.go", sha256: patchedSourceHash } },
      statisticsPatch: { ...evidence("statistics.patch"), patchedSource: { path: "tunnel/statistic/manager.go", sha256: patchedStatisticsHash } },
      lateConnectionsPatch: {
        path: `${bridgeDir}/late-connections.patch`, sha256: digest(lateConnectionsPatch),
        patchedSources: {
          manager: { path: "tunnel/statistic/manager.go", sha256: patchedStatisticsHash },
          tracker: { path: "tunnel/statistic/tracker.go", sha256: patchedTrackerHash },
          tunnel: { path: "tunnel/tunnel.go", sha256: patchedTunnelHash },
          natTable: { path: "component/nat/table.go", sha256: patchedNatTableHash },
          connection: { path: "tunnel/connection.go", sha256: patchedConnectionHash },
          quicSniffer: { path: "component/sniffer/quic_sniffer.go", sha256: patchedQuicSnifferHash },
          tproxyPacket: { path: "listener/tproxy/packet.go", sha256: patchedTproxyPacketHash },
          dhcpDiscovery: { path: "component/dhcp/dhcp.go", sha256: patchedDhcpDiscoveryHash },
          dnsDoH: { path: "dns/doh.go", sha256: patchedDnsDoHHash },
          ntpService: { path: "ntp/ntp/service.go", sha256: patchedNtpServiceHash },
          socks5Association: { path: "adapter/outbound/socks5.go", sha256: patchedSocks5AssociationHash }, dnsClient: { path: "dns/client.go", sha256: patchedDnsClientHash }, dnsTLS: { path: "dns/dot.go", sha256: patchedDnsTLSHash }, dnsDHCP: { path: "dns/dhcp.go", sha256: patchedDnsDHCPHash }, dnsUtil: { path: "dns/util.go", sha256: patchedDnsUtilHash },
        },
      },
    };
    writeFileSync(join(dir, `mihomo-provenance-${abi}.json`), JSON.stringify(provenance));
  }
  writeFileSync(join(repo, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"),
    `const val VERSION = "v1.19.32"\nconst val SOURCE_COMMIT = "${commit}"\nconst val PATCHED_TPROXY_PACKET_SHA256 = "${patchedTproxyPacketHash}"\n` + abis.map(abi => `MihomoNativeLibrarySpec(abi = "${abi}", sha256 = "${records[abi].sha256}")`).join("\n"));
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
  assert.match(provenance.run, /PATCHED_TPROXY_PACKET_SHA256/);
  assert.match(provenance.run, /PATCHED_PROVIDER_FETCHER_SHA256/);
  assert.match(provenance.run, /"providerFetcher": \{"path": "component\/resource\/fetcher\.go", "sha256": "\$PATCHED_PROVIDER_FETCHER_SHA256"\}/);
  assert.match(provenance.run, /"tproxyPacket": \{\"path\": \"listener\/tproxy\/packet\.go\", \"sha256\": \"\$PATCHED_TPROXY_PACKET_SHA256\"\}/);
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
