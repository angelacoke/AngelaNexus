import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const SCRIPT = join(process.cwd(), "scripts/mihomo-debug-evidence.py");
const UPSTREAM_COMMIT = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36";
const PROJECT_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OWNER = "example/AngelaNexus";
const ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64"];
const COMMIT = UPSTREAM_COMMIT;
const REPOSITORY = "https://github.com/MetaCubeX/mihomo";
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
  const patchedMixed = Buffer.from("fixture patched mixed\n");
  const patchedMixedRegistry = Buffer.from("fixture patched mixed registry\n");
  const patchedMixedUDP = Buffer.from("fixture patched mixed UDP\n");
  const patchedMixedUDPRegistry = Buffer.from("fixture patched mixed UDP registry\n");
  const patchedListener = Buffer.from("fixture patched listener\n");
  const patchedNamedMixed = Buffer.from("fixture patched named mixed\n");
  const patchedNamedMixedRegistry = Buffer.from("fixture patched named mixed registry\n");
  const namedInboundLifecyclePatch = Buffer.from("fixture named inbound lifecycle patch\n");
  const mixedLifecyclePatch = Buffer.from("fixture mixed lifecycle patch\n");
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
  const authStatePatch = Buffer.from("fixture auth state patch\n");
  const authStatePaths = [
    "adapter/inbound/auth.go",
    "adapter/inbound/ipfilter.go",
    "adapter/inbound/auth_state.go",
    "listener/auth/auth.go",
    "listener/mixed/mixed.go",
    "listener/socks/tcp.go",
    "listener/http/server.go",
    "hub/executor/executor.go",
  ];
  const authInputs = Object.fromEntries(authStatePaths.map(path => [path, Buffer.from(`fixture auth input ${path}\n`)]));
  const authOutputs = Object.fromEntries(authStatePaths.map(path => [path, Buffer.from(`fixture auth output ${path}\n`)]));
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
  mkdirSync(join(root, "listener/mixed"), { recursive: true });
  mkdirSync(join(root, "listener/inbound"), { recursive: true });
  mkdirSync(join(root, "listener/socks"), { recursive: true });
  writeFileSync(join(root, "listener/mixed/mixed.go"), patchedMixed);
  writeFileSync(join(root, "listener/mixed/lifecycle.go"), patchedMixedRegistry);
  writeFileSync(join(root, "listener/inbound/mixed.go"), patchedNamedMixed);
  writeFileSync(join(root, "listener/inbound/mixed_lifecycle.go"), patchedNamedMixedRegistry);
  writeFileSync(join(root, "listener/socks/udp.go"), patchedMixedUDP);
  writeFileSync(join(root, "listener/socks/udp_lifecycle.go"), patchedMixedUDPRegistry);
  writeFileSync(join(root, "listener/listener.go"), patchedListener);
  writeFileSync(join(root, "listener/sing_tun/server.go"), patchedSource);
  writeFileSync(join(root, "listener/tproxy/packet.go"), patchedTproxyPacket);
  writeFileSync(join(root, "tunnel/statistic/manager.go"), patchedStatistics);
  writeFileSync(join(root, "tunnel/statistic/tracker.go"), patchedTracker);
  writeFileSync(join(root, "tunnel/tunnel.go"), patchedTunnel);
  writeFileSync(join(sourceDir, "statistics.patch"), statisticsPatch);
  writeFileSync(join(sourceDir, "late-connections.patch"), lateConnectionsPatch);
  writeFileSync(join(sourceDir, "mixed-lifecycle.patch"), mixedLifecyclePatch);
  writeFileSync(join(sourceDir, "named-inbound-lifecycle.patch"), namedInboundLifecyclePatch);
  writeFileSync(join(sourceDir, "auth-state.patch"), authStatePatch);
  mkdirSync(sourceDir, { recursive: true });
  for (const [path, bytes] of Object.entries(authInputs)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  for (const [path, bytes] of Object.entries(authOutputs)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  writeFileSync(join(sourceDir, "bridge.go"), bridge);
  writeFileSync(join(sourceDir, "lifecycle.go"), lifecycle);
  writeFileSync(join(sourceDir, "library.go"), libraryEntry);
  const adapterSource = `PATCHED_SERVER_SHA256 = "${digest(patchedSource)}"\nPATCHED_DNS_RESOLVER_SHA256 = "${digest(patchedDnsResolver)}"\nPATCHED_DNS_SERVER_SHA256 = "${digest(patchedDnsServer)}"\nPATCHED_DNS_DOH_SHA256 = "${digest(patchedDnsDoH)}"\nPATCHED_DNS_CLIENT_SHA256 = "${digest(patchedDnsClient)}"\nPATCHED_DNS_TLS_SHA256 = "${digest(patchedDnsTLS)}"\nPATCHED_DNS_DHCP_SHA256 = "${digest(patchedDnsDHCP)}"\nPATCHED_DNS_UTIL_SHA256 = "${digest(patchedDnsUtil)}"\nPATCHED_DHCP_DISCOVERY_SHA256 = "${digest(patchedDhcpDiscovery)}"\nPATCHED_NTP_SERVICE_SHA256 = "${digest(patchedNtpService)}"\nPATCHED_SOCKS5_SHA256 = "${digest(patchedSocks5)}"\nPATCHED_DNS_OUTBOUND_SHA256 = "${digest(patchedDnsOutbound)}"\nPATCHED_MIXED_SHA256 = "${digest(patchedMixed)}"\nPATCHED_MIXED_REGISTRY_SHA256 = "${digest(patchedMixedRegistry)}"\nPATCHED_MIXED_UDP_SHA256 = "${digest(patchedMixedUDP)}"\nPATCHED_MIXED_UDP_REGISTRY_SHA256 = "${digest(patchedMixedUDPRegistry)}"\nPATCHED_LISTENER_SHA256 = "${digest(patchedListener)}"\nPATCHED_NAMED_MIXED_SHA256 = "${digest(patchedNamedMixed)}"\nPATCHED_NAMED_MIXED_REGISTRY_SHA256 = "${digest(patchedNamedMixedRegistry)}"\nPATCHED_NAMED_LISTENER_SHA256 = "${digest(patchedListener)}"\nNAMED_INBOUND_LIFECYCLE_PATCH_SHA256 = "${digest(namedInboundLifecyclePatch)}"\nMIXED_LIFECYCLE_PATCH_SHA256 = "${digest(mixedLifecyclePatch)}"\nPATCHED_PROVIDER_FETCHER_SHA256 = "${digest(patchedProviderFetcher)}"\nPATCHED_PROVIDER_HEALTHCHECK_SHA256 = "${digest(patchedProviderHealthcheck)}"\nPATCHED_PROXY_PROVIDER_SHA256 = "${digest(patchedProxyProvider)}"\nPATCHED_STATISTICS_SHA256 = "${digest(patchedStatistics)}"\nSTATISTICS_PATCH_SHA256 = "${digest(statisticsPatch)}"\nLATE_CONNECTIONS_PATCH_SHA256 = "${digest(lateConnectionsPatch)}"\nPATCHED_LATE_MANAGER_SHA256 = "${digest(patchedStatistics)}"\nPATCHED_TRACKER_SHA256 = "${digest(patchedTracker)}"\nPATCHED_TUNNEL_SHA256 = "${digest(patchedTunnel)}"\nPATCHED_NAT_TABLE_SHA256 = "${digest(patchedNatTable)}"\nPATCHED_CONNECTION_SHA256 = "${digest(patchedConnection)}"\nPATCHED_QUIC_SNIFFER_SHA256 = "${digest(patchedQuicSniffer)}"\nPATCHED_TPROXY_PACKET_SHA256 = "${digest(patchedTproxyPacket)}"\nPATCHED_LOG_SHA256 = "${digest(patchedLog)}"\n\nAUTH_STATE_PATCH_SHA256 = "${digest(authStatePatch)}"\nAUTH_STATE_INPUTS = {${Object.entries(authInputs).map(([path, bytes]) => `"${path}": "${digest(bytes)}"`).join(", ")}}\nAUTH_STATE_OUTPUTS = {${Object.entries(authOutputs).map(([path, bytes]) => `"${path}": "${digest(bytes)}"`).join(", ")}}\n`;
  writeFileSync(join(sourceDir, "prepare-upstream.py"), adapterSource);
  const adapterSha = digest(adapterSource);
  const records = {};
  const cSource = `__attribute__((visibility("default"))) void angelaInit(void){}
__attribute__((visibility("default"))) void angelaApplyConfig(void){}
__attribute__((visibility("default"))) void startTUN(void){}
__attribute__((visibility("default"))) void angelaStopTun(void){}
__attribute__((visibility("default"))) void stopTun(void){}
__attribute__((visibility("default"))) void updateDns(void){}
__attribute__((visibility("default"))) void suspend(void){}
__attribute__((visibility("default"))) void forceGC(void){}
__attribute__((visibility("default"))) void getTraffic(void){}
__attribute__((visibility("default"))) void getTotalTraffic(void){}
__attribute__((visibility("default"))) void freeCString(void){}
`;
  const shimSource = `__attribute__((visibility("default"))) void JNI_OnLoad(void){}
__attribute__((visibility("default"))) void angelanexus_protect_fd(void){}
${["nativeApplyConfig", "nativeForceGc", "nativeGetTotalTraffic", "nativeGetTraffic", "nativeHasVpnProtector", "nativeInitialize", "nativeInvokeMethod", "nativeSetEventListener", "nativeSetSuspended", "nativeSetVpnService", "nativeStartTun", "nativeStopTun", "nativeUpdateDns"].map(name => `__attribute__((visibility("default"))) void Java_app_angelanexus_MihomoJniNativeHost_${name}(void){}`).join("\n")}
`;
  const cPath = join(root, "fixture.c"), shimPath = join(root, "shim.c");
  writeFileSync(cPath, cSource); writeFileSync(shimPath, shimSource);
  for (const abi of ABIS) {
    const dir = join(artifacts, abi); mkdirSync(dir, { recursive: true });
    const out = join(dir, `libclash-${abi}.so`);
    const r = spawnSync("gcc", ["-shared", "-nostdlib", "-Wl,-E", ...(abi === "armeabi-v7a" ? ["-m32"] : []), "-o", out, cPath], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    if (abi === "arm64-v8a" || abi === "armeabi-v7a") { const b = readFileSync(out); const machine = abi === "arm64-v8a" ? 183 : 40; b[18] = machine; b[19] = 0; writeFileSync(out, b); }
    const bytes = readFileSync(out), sha = digest(bytes);
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
      projectCommit: PROJECT_COMMIT,
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
      mixedListener: { path: "listener/mixed/mixed.go", sha256: digest(authOutputs["listener/mixed/mixed.go"]) },
      mixedListenerRegistry: { path: "listener/mixed/lifecycle.go", sha256: digest(patchedMixedRegistry) },
      mixedUDPListener: { path: "listener/socks/udp.go", sha256: digest(patchedMixedUDP) },
      mixedUDPRegistry: { path: "listener/socks/udp_lifecycle.go", sha256: digest(patchedMixedUDPRegistry) },
      namedMixedListener: { path: "listener/inbound/mixed.go", sha256: digest(patchedNamedMixed) },
      namedMixedRegistry: { path: "listener/inbound/mixed_lifecycle.go", sha256: digest(patchedNamedMixedRegistry) },
      inboundListener: { path: "listener/listener.go", sha256: digest(patchedListener) },
      providerFetcher: { path: "component/resource/fetcher.go", sha256: digest(patchedProviderFetcher) },
      providerHealthCheck: { path: "adapter/provider/healthcheck.go", sha256: digest(patchedProviderHealthcheck) },
      proxyProvider: { path: "adapter/provider/provider.go", sha256: digest(patchedProxyProvider) },
      logSource: { path: "log/log.go", sha256: digest(patchedLog) },
      ownershipAdapter: {
        path: "native/android/mihomo-bridge/prepare-upstream.py",
        sha256: adapterSha,
        patchedSource: { path: "listener/sing_tun/server.go", sha256: digest(patchedSource) },
      },
      authStateAdapter: {
        path: "native/android/mihomo-bridge/auth-state.patch",
        sha256: digest(authStatePatch),
        inputs: Object.fromEntries(Object.entries(authInputs).map(([path, bytes]) => [path, digest(bytes)])),
        outputs: Object.fromEntries(Object.entries(authOutputs).map(([path, bytes]) => [path, digest(bytes)])),
      },
      statisticsPatch: {
        path: "native/android/mihomo-bridge/statistics.patch",
        sha256: digest(statisticsPatch),
        patchedSource: { path: "tunnel/statistic/manager.go", sha256: digest(patchedStatistics) },
      },
      mixedListenerAdapter: { path: "native/android/mihomo-bridge/mixed-lifecycle.patch", sha256: digest(mixedLifecyclePatch) },
      namedInboundAdapter: { path: "native/android/mihomo-bridge/named-inbound-lifecycle.patch", sha256: digest(namedInboundLifecyclePatch) },
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
      mixedListener: { path: "listener/mixed/mixed.go", sha256: digest(authOutputs["listener/mixed/mixed.go"]) },
      mixedListenerRegistry: { path: "listener/mixed/lifecycle.go", sha256: digest(patchedMixedRegistry) },
      namedMixedListener: { path: "listener/inbound/mixed.go", sha256: digest(patchedNamedMixed) },
      namedMixedRegistry: { path: "listener/inbound/mixed_lifecycle.go", sha256: digest(patchedNamedMixedRegistry) },
      inboundListener: { path: "listener/listener.go", sha256: digest(patchedListener) },
        },
      },
      artifact: { name: artifact, sha256: records[abi].sha256 },
    }));
  }
  return { root, artifacts };
}

function makeGh(fx) {
  const bin = join(fx.root, "bin"); mkdirSync(bin, { recursive: true });
  const gh = join(bin, "gh");
  const script = `#!/usr/bin/env python3
import json, os, shutil, sys
args=sys.argv[1:]
if args[:2] == ["api", "repos/${OWNER}/actions/runs/123456789"]:
 print(json.dumps({"id":123456789,"repository":{"full_name":"${OWNER}"},"head_repository":{"full_name":"${OWNER}"},"head_sha":"${PROJECT_COMMIT}","status":"completed","conclusion":"success","path":".github/workflows/mihomo-android-native-build.yml","event":"workflow_dispatch"})); sys.exit(0)
if args[:3] == ["run", "download", "123456789"]:
 out=args[args.index("--dir")+1]; name=args[args.index("--name")+1]; abi=name.removeprefix("mihomo-v1.19.32-")
 src=os.path.join(${JSON.stringify(fx.root)}, "artifacts", {"arm64-v8a":"arm64-v8a","armeabi-v7a":"armeabi-v7a","x86_64":"x86_64"}[abi])
 os.makedirs(out,exist_ok=True)
 for n in os.listdir(src): shutil.copy2(os.path.join(src,n), os.path.join(out,n))
 sys.exit(0)
print("unexpected gh call", args, file=sys.stderr); sys.exit(2)
`;
  writeFileSync(gh, script); chmodSync(gh, 0o755); return bin;
}
function sourceRun(overrides={}) { return {id:123456789, repository:{full_name:OWNER}, head_repository:{full_name:OWNER}, head_sha:PROJECT_COMMIT, status:"completed", conclusion:"success", path:".github/workflows/mihomo-android-native-build.yml", event:"workflow_dispatch", ...overrides}; }
function apk(fx, edits=[]) {
  const dir=join(fx.root,"apk"); mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,"AndroidManifest.xml"),"manifest"); writeFileSync(join(dir,"classes.dex"),"dex");
  for (const abi of ABIS) { mkdirSync(join(dir,"lib",abi),{recursive:true}); const core=readFileSync(join(fx.root,"artifacts",abi,`libclash-${abi}.so`)); writeFileSync(join(dir,"lib",abi,"libclash.so"),core); const r=spawnSync("gcc",["-shared","-nostdlib",...(abi==="armeabi-v7a"?["-m32"]:[]),"-o",join(dir,"lib",abi,"libmihomo-jni.so"),join(fx.root,"shim.c")]); if(r.status!==0) throw Error(r.stderr); if(abi==="arm64-v8a"||abi==="armeabi-v7a"){const p=join(dir,"lib",abi,"libmihomo-jni.so"),b=readFileSync(p),machine=abi==="arm64-v8a"?183:40;b[18]=machine;b[19]=0;writeFileSync(p,b);} }
  const zip=join(fx.root,"app.apk"); const r=spawnSync("zip",["-q","-r",zip,"."],{cwd:dir}); if(r.status!==0) throw Error(r.stderr); return zip;
}
function runVerify(fx, mut={}) { const report=join(fx.root,"report.json"); const args=[SCRIPT,"verify","--apk",mut.apk||apk(fx),"--evidence-root",fx.evidence,"--expected-commit",mut.expected||PROJECT_COMMIT,"--repo-root",fx.root,"--report",report]; const r=spawnSync("python3",args,{encoding:"utf8",env:{...process.env,GITHUB_REPOSITORY:OWNER}}); return {...r,report}; }
function prepare(fx, mut={}) { const out=join(fx.root,"prepared"); const env={...process.env,GITHUB_REPOSITORY:OWNER,PATH:`${makeGh(fx)}:${process.env.PATH}`}; const r=spawnSync("python3",[SCRIPT,"prepare","--run-id","123456789","--source-commit",mut.source||PROJECT_COMMIT,"--output",out,"--repo-root",fx.root],{encoding:"utf8",env}); return {...r,out}; }
function withFixture(fn) { const fx=fixture(); fx.evidence=fx.root; try { fn(fx); } finally { rmSync(fx.root,{recursive:true,force:true}); } }

// gcc fixtures exercise ELF parsing only. Patched machine headers are not
// executable ARM binaries and are never represented as Android/runtime proof.
function ready(fn) {
  withFixture(fx => {
    const result = prepare(fx);
    assert.equal(result.status, 0, result.stderr);
    fx.evidence = result.out;
    fx.apk = apk(fx);
    fn(fx);
  });
}
function rewrite(path, mutate) {
  const value = JSON.parse(readFileSync(path));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
}
function rejected(fx, reason, options = {}) {
  const result = runVerify(fx, { apk: fx.apk, ...options });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, reason);
  assert.equal(existsSync(result.report), false);
}
function repack(fx) {
  const output = join(fx.root, "mutated.apk");
  const result = spawnSync("zip", ["-q", "-r", output, "."], { cwd: join(fx.root, "apk") });
  assert.equal(result.status, 0, String(result.stderr));
  fx.apk = output;
}
function repinFixtureOnly(fx, abi, bytes) {
  // Test-only trusted inputs let ELF checks run after the real hash verifier.
  const path = join(fx.evidence, "artifacts", abi, `libclash-${abi}.so`);
  const oldHash = digest(readFileSync(path));
  const sha256 = digest(bytes);
  writeFileSync(path, bytes);
  const manifest = join(fx.root, "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt");
  const compliance = join(fx.root, "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace(oldHash, sha256));
  rewrite(compliance, data => { data.artifacts[abi].sha256 = sha256; });
  rewrite(join(fx.evidence, "artifacts", abi, `mihomo-provenance-${abi}.json`), data => { data.artifact.sha256 = sha256; });
  rewrite(join(fx.evidence, "preparation-report.json"), data => {
    data.manifestSha256 = digest(readFileSync(manifest));
    data.complianceSha256 = digest(readFileSync(compliance));
  });
}

test("legal prepare and verify, keeping project and upstream commits distinct", () => ready(fx => {
  const result = runVerify(fx, { apk: fx.apk });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(result.report));
  assert.equal(report.verified, true);
  assert.equal(report.sourceCommit, PROJECT_COMMIT);
  assert.notEqual(PROJECT_COMMIT, UPSTREAM_COMMIT);
  for (const abi of ABIS) {
    const row = report.libraries[abi];
    assert.equal(row.sourceSha256, row.installedSha256);
    assert.equal(row.sourceSha256, row.apkSha256);
    assert.notEqual(row.sourceSha256, row.shimSha256);
  }
}));
for (const [name, mutate, reason] of [
  ["missing source core", fx => rmSync(join(fx.evidence, "artifacts/x86_64/libclash-x86_64.so")), /must contain exactly/],
  ["tampered source core", fx => writeFileSync(join(fx.evidence, "artifacts/x86_64/libclash-x86_64.so"), "tamper"), /artifact SHA-256 mismatch/],
  ["tampered installed core", fx => writeFileSync(join(fx.evidence, "jniLibs/x86_64/libclash.so"), "tamper"), /source\/jni hash mismatch/],
  ["provenance artifact hash", fx => rewrite(join(fx.evidence, "artifacts/arm64-v8a/mihomo-provenance-arm64-v8a.json"), d => { d.artifact.sha256 = "0".repeat(64); }), /artifact SHA-256 mismatch/],
  ["provenance project SHA", fx => rewrite(join(fx.evidence, "artifacts/arm64-v8a/mihomo-provenance-arm64-v8a.json"), d => { d.projectCommit = UPSTREAM_COMMIT; }), /projectCommit mismatch/],
  ["missing provenance project SHA", fx => rewrite(join(fx.evidence, "artifacts/arm64-v8a/mihomo-provenance-arm64-v8a.json"), d => { delete d.projectCommit; }), /projectCommit mismatch/],
  ["wrong ELF machine", fx => { const b = readFileSync(join(fx.evidence, "artifacts/arm64-v8a/libclash-arm64-v8a.so")); b[18] = 62; repinFixtureOnly(fx, "arm64-v8a", b); }, /ELF machine mismatch/],
  ["wrong ELF class", fx => { const b = readFileSync(join(fx.evidence, "artifacts/arm64-v8a/libclash-arm64-v8a.so")); b[4] = 1; repinFixtureOnly(fx, "arm64-v8a", b); }, /ELF class mismatch/],
  ["missing updateDns export", fx => { const b = readFileSync(join(fx.evidence, "artifacts/x86_64/libclash-x86_64.so")); const changed = Buffer.from(b.toString("latin1").replaceAll("updateDns", "xpdateDns"), "latin1"); repinFixtureOnly(fx, "x86_64", changed); }, /missing required function exports: updateDns/],
]) test(`reject ${name} at intended gate`, () => ready(fx => { mutate(fx); rejected(fx, reason); }));

for (const [name, mutate, reason] of [
  ["missing APK core", fx => rmSync(join(fx.root, "apk/lib/x86_64/libclash.so")), /libclash.so ABI set mismatch/],
  ["extra APK ABI", fx => { mkdirSync(join(fx.root, "apk/lib/mips")); writeFileSync(join(fx.root, "apk/lib/mips/libclash.so"), "extra"); }, /libclash.so ABI set mismatch/],
  ["tampered APK core", fx => writeFileSync(join(fx.root, "apk/lib/arm64-v8a/libclash.so"), "tamper"), /APK\/source hash mismatch/],
  ["missing shim", fx => rmSync(join(fx.root, "apk/lib/x86_64/libmihomo-jni.so")), /libmihomo-jni.so ABI set mismatch/],
  ["identical shim", fx => writeFileSync(join(fx.root, "apk/lib/arm64-v8a/libmihomo-jni.so"), readFileSync(join(fx.root, "apk/lib/arm64-v8a/libclash.so"))), /shim is identical to core/],
  ["wrong shim ABI", fx => { const path = join(fx.root, "apk/lib/arm64-v8a/libmihomo-jni.so"); const b = readFileSync(path); b[18] = 62; writeFileSync(path, b); }, /ELF machine mismatch/],
  ["missing APK manifest", fx => rmSync(join(fx.root, "apk/AndroidManifest.xml")), /not an APK application/],
]) test(`reject ${name}`, () => ready(fx => { mutate(fx); repack(fx); rejected(fx, reason); }));

test("reject actual duplicate ZIP entry", () => ready(fx => {
  const result = spawnSync("python3", ["-c", "import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1], 'a') as z: z.writestr('AndroidManifest.xml', b'duplicate')", fx.apk]);
  assert.equal(result.status, 0);
  rejected(fx, /duplicate ZIP entry/);
}));
test("remove stale successful report on APK failure", () => ready(fx => {
  writeFileSync(join(fx.root, "report.json"), "stale success");
  writeFileSync(fx.apk, "not a ZIP");
  rejected(fx, /not a zip file/);
}));
test("reject wrong expected project commit", () => ready(fx => rejected(fx, /metadata mismatch: head_sha/, { expected: "0".repeat(40) })));
for (const field of ["repository", "head_repository", "head_sha", "status", "conclusion", "path", "event", "id"]) {
  test(`source metadata guard ${field}`, () => ready(fx => {
    rewrite(join(fx.evidence, "source-run.json"), data => {
      data[field] = ["repository", "head_repository"].includes(field) ? { full_name: "evil/repo" }
        : field === "head_sha" ? "0".repeat(40) : field === "id" ? "bad" : "pull_request";
    });
    rejected(fx, /source-run/);
  }));
}
