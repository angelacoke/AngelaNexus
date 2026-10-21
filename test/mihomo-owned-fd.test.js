import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const adapter = new URL("../native/android/mihomo-bridge/prepare-upstream.py", import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const workflow = yaml.load(read(".github/workflows/mihomo-android-native-build.yml"));

 test("owned-fd build prepares the pinned source before copying the bridge and records required evidence", () => {
  const steps = workflow.jobs.build.steps;
  const copy = steps.find(step => step.name === "Add AngelaNexus Android bridge");
  assert.ok(copy.run.indexOf("prepare-upstream.py") < copy.run.indexOf("mkdir ./angelanexus_android"));
  const provenance = steps.find(step => step.name === "Generate native build provenance evidence");
  assert.match(provenance.run, /"ownershipAdapter": \{"path": "native\/android\/mihomo-bridge\/prepare-upstream\.py", "sha256": "\$ADAPTER_SHA256", "patchedSource": \{"path": "listener\/sing_tun\/server\.go", "sha256": "\$PATCHED_SERVER_SHA256"\}\}/);
  assert.match(provenance.run, /sha256sum "\$RUNNER_TEMP\/mihomo\/listener\/sing_tun\/server\.go"/);
});

// Exercise the real verification function with a complete pinned source fixture.
for (const mode of ["clean", "exact-fetcher", "modified-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-dns-client", "exact-dns-tls", "exact-dns-dhcp", "exact-dns-util", "exact-server", "exact-statistics", "exact-late", "exact-quic", "marker-server", "modified-tracker", "modified-nat", "modified-connection", "modified-quic", "exact-tproxy", "exact-ntp", "modified-tproxy", "modified-ntp", "modified-dns", "modified-doh", "modified-dns-server", "unknown-dirty", "wrong-commit"]) {
  test(`owned-fd source verification is fail-closed: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import hashlib, importlib.util, json, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("owned_adapter", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); (root / ".git").mkdir()
    pristine = {
      "go.mod": "github.com/metacubex/sing-tun v0.4.27\\n", "go.sum": "github.com/metacubex/sing-tun v0.4.27 h1:fixture\\n",
      "listener/sing_tun/server.go": "pristine server\\n", "listener/sing_tun/server_notwindows.go": "pristine notwindows\\n",
      "tunnel/statistic/manager.go": "pristine manager\\n", "tunnel/statistic/tracker.go": "pristine tracker\\n", "tunnel/tunnel.go": "pristine tunnel\\n", "component/nat/table.go": "pristine nat\\n", "tunnel/connection.go": "pristine connection\\n", "component/sniffer/quic_sniffer.go": "pristine QUIC\\n", "listener/tproxy/packet.go": "pristine TProxy packet\\n", "dns/resolver.go": "pristine DNS resolver\\n", "dns/server.go": "pristine DNS server\\n", "dns/doh.go": "pristine DNS DoH\\n", "component/resource/fetcher.go": "pristine fetcher\\n", "log/log.go": "pristine log\\n", "adapter/provider/healthcheck.go": "pristine healthcheck\\n", "adapter/provider/provider.go": "pristine provider\\n", "ntp/ntp/service.go": "pristine ntp service\\n"}
    for rel, text in pristine.items():
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
    final = {"listener/sing_tun/server.go": "reviewed server\\n", "tunnel/statistic/manager.go": "reviewed manager\\n", "tunnel/statistic/tracker.go": "reviewed tracker\\n", "tunnel/tunnel.go": "reviewed tunnel\\n", "component/nat/table.go": "reviewed nat\\n", "tunnel/connection.go": "reviewed connection\\n", "component/sniffer/quic_sniffer.go": "reviewed QUIC\\n", "listener/tproxy/packet.go": "reviewed TProxy packet\\n", "dns/resolver.go": "reviewed DNS resolver\\n", "dns/server.go": "reviewed DNS server\\n", "dns/doh.go": "reviewed DNS DoH\\n", "component/resource/fetcher.go": "reviewed fetcher\\n", "log/log.go": "reviewed log\\n", "adapter/provider/healthcheck.go": "reviewed healthcheck\\n", "adapter/provider/provider.go": "reviewed provider\\n", "ntp/ntp/service.go": "reviewed ntp service\\n"}
    m.EXPECTED = {rel: m.sha256(root / rel) for rel in pristine}
    for rel, text in final.items():
        p = root / rel; p.write_text(text)
    m.PATCHED_SERVER_SHA256 = m.sha256(root / "listener/sing_tun/server.go")
    m.PATCHED_PROVIDER_FETCHER_SHA256 = m.sha256(root / "component/resource/fetcher.go")
    m.PATCHED_LOG_SHA256 = m.sha256(root / "log/log.go")
    m.PATCHED_PROVIDER_HEALTHCHECK_SHA256 = m.sha256(root / "adapter/provider/healthcheck.go")
    m.PATCHED_PROXY_PROVIDER_SHA256 = m.sha256(root / "adapter/provider/provider.go")
    m.PATCHED_DNS_RESOLVER_SHA256 = m.sha256(root / "dns/resolver.go")
    m.PATCHED_DNS_SERVER_SHA256 = m.sha256(root / "dns/server.go")
    m.PATCHED_DNS_DOH_SHA256 = m.sha256(root / "dns/doh.go")
    m.PATCHED_NTP_SERVICE_SHA256 = m.sha256(root / "ntp/ntp/service.go")
    m.PATCHED_STATISTICS_SHA256 = m.sha256(root / "tunnel/statistic/manager.go")
    m.PATCHED_LATE_MANAGER_SHA256 = m.PATCHED_STATISTICS_SHA256
    m.PATCHED_TRACKER_SHA256 = m.sha256(root / "tunnel/statistic/tracker.go")
    m.PATCHED_TUNNEL_SHA256 = m.sha256(root / "tunnel/tunnel.go")
    m.PATCHED_NAT_TABLE_SHA256 = m.sha256(root / "component/nat/table.go")
    m.PATCHED_CONNECTION_SHA256 = m.sha256(root / "tunnel/connection.go")
    m.PATCHED_QUIC_SNIFFER_SHA256 = m.sha256(root / "component/sniffer/quic_sniffer.go")
    m.PATCHED_TPROXY_PACKET_SHA256 = m.sha256(root / "listener/tproxy/packet.go")
    for rel in final: (root / rel).write_text(pristine[rel])
    status = ""; commit = m.COMMIT
    if mode == "exact-fetcher":
        (root / "component/resource/fetcher.go").write_text(final["component/resource/fetcher.go"]); status = " M component/resource/fetcher.go\\n"
    elif mode == "modified-fetcher":
        (root / "component/resource/fetcher.go").write_text("modified fetcher\\n"); status = " M component/resource/fetcher.go\\n"
    elif mode == "exact-ntp":
        (root / "ntp/ntp/service.go").write_text(final["ntp/ntp/service.go"]); status = " M ntp/ntp/service.go\\n"
    elif mode == "modified-ntp":
        (root / "ntp/ntp/service.go").write_text("modified ntp service\\n"); status = " M ntp/ntp/service.go\\n"
    elif mode == "exact-doh":
        (root / "dns/doh.go").write_text(final["dns/doh.go"]); status = " M dns/doh.go\\n"
    elif mode == "exact-dns-server":
        (root / "dns/server.go").write_text(final["dns/server.go"]); status = " M dns/server.go\\n"
    elif mode == "exact-server":
        (root / "listener/sing_tun/server.go").write_text(final["listener/sing_tun/server.go"]); status = " M listener/sing_tun/server.go\\n"
    elif mode == "exact-statistics":
        (root / "tunnel/statistic/manager.go").write_text(final["tunnel/statistic/manager.go"]); status = " M tunnel/statistic/manager.go\\n"
    elif mode == "exact-late":
        for rel in final: (root / rel).write_text(final[rel])
        status = "".join(" M " + rel + "\\n" for rel in final)
    elif mode == "exact-quic":
        (root / "component/sniffer/quic_sniffer.go").write_text(final["component/sniffer/quic_sniffer.go"]); status = " M component/sniffer/quic_sniffer.go\\n"
    elif mode == "exact-dns":
        (root / "dns/resolver.go").write_text(final["dns/resolver.go"]); status = " M dns/resolver.go\
"
    elif mode == "exact-tproxy":
        (root / "listener/tproxy/packet.go").write_text(final["listener/tproxy/packet.go"]); status = " M listener/tproxy/packet.go\
"
    elif mode == "modified-doh":
        (root / "dns/doh.go").write_text("modified DNS DoH\\n"); status = " M dns/doh.go\\n"
    elif mode == "modified-dns-server":
        (root / "dns/server.go").write_text("modified DNS server\\n"); status = " M dns/server.go\\n"
    elif mode == "modified-dns":
        (root / "dns/resolver.go").write_text("modified DNS resolver\
"); status = " M dns/resolver.go\
"
    elif mode == "marker-server":
        (root / "listener/sing_tun/server.go").write_text("func NewWithOwnedFD() {}\\n"); status = " M listener/sing_tun/server.go\\n"
    elif mode == "modified-tracker":
        (root / "tunnel/statistic/tracker.go").write_text("modified tracker\\n"); status = " M tunnel/statistic/tracker.go\\n"
    elif mode == "modified-nat":
        (root / "component/nat/table.go").write_text("modified nat\\n"); status = " M component/nat/table.go\\n"
    elif mode == "modified-connection":
        (root / "tunnel/connection.go").write_text("modified connection\\n"); status = " M tunnel/connection.go\\n"
    elif mode == "modified-quic":
        (root / "component/sniffer/quic_sniffer.go").write_text("modified QUIC\\n"); status = " M component/sniffer/quic_sniffer.go\\n"
    elif mode == "modified-tproxy":
        (root / "listener/tproxy/packet.go").write_text("modified TProxy\\n"); status = " M listener/tproxy/packet.go\\n"
    elif mode == "unknown-dirty": status = "?? unreviewed.go\\n"
    elif mode == "wrong-commit": commit = "0" * 40
    def output(command, **kwargs):
        if command[0] == "git": return commit if "rev-parse" in command else status
        module = root / "fixture-module"; module.mkdir(exist_ok=True)
        (module / "tun_linux.go").write_text("func New(options Options) (Tun, error) {}\\n")
        m.SING_TUN_TUN_LINUX_SHA256 = m.sha256(module / "tun_linux.go")
        return json.dumps({"Version":"v0.4.27", "Dir":str(module), "Sum":"h1:fixture"})
    m.subprocess.check_output = output
    try: m.verify_source(root)
    except SystemExit:
        assert mode not in ("clean", "exact-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-dns-client", "exact-dns-tls", "exact-dns-dhcp", "exact-dns-util", "exact-server", "exact-statistics", "exact-late", "exact-quic", "exact-tproxy", "exact-ntp"), mode
    else: assert mode in ("clean", "exact-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-dns-client", "exact-dns-tls", "exact-dns-dhcp", "exact-dns-util", "exact-server", "exact-statistics", "exact-late", "exact-quic", "exact-tproxy", "exact-ntp"), "accepted incompatible source: " + mode
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

// Exercise all reviewed source sections in their exact application order.
// Every rejected input/output/path must leave every source byte untouched.
const lateSourceNames = ["manager", "tracker", "tunnel", "nat", "connection", "quic", "tproxy", "dns", "dns-server", "doh", "fetcher", "log", "healthcheck", "proxy-provider", "client", "tls", "dhcp", "util", "dhcp-discovery", "ntp", "dns-outbound"];
const lateAtomicModes = ["clean", "all-final", "late-patch-tampered", "last-output-hash-error", "last-section-invalid", "path-traversal-section", "partial-final-mixed", "unknown-source-section", ...lateSourceNames.flatMap(name => ["input-tampered", "output-hash-error", "partial-final-mixed", "path-traversal", "section-invalid"].map(fault => `${name}-${fault}`))];
for (const mode of lateAtomicModes) {
  test(`late patch application is exact and atomic: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); m.__file__ = str(root / "prepare-upstream.py")
    entries = [
        ("manager", "tunnel/statistic/manager.go", "PATCHED_LATE_MANAGER_SHA256"),
        ("tracker", "tunnel/statistic/tracker.go", "PATCHED_TRACKER_SHA256"),
        ("tunnel", "tunnel/tunnel.go", "PATCHED_TUNNEL_SHA256"),
        ("nat", "component/nat/table.go", "PATCHED_NAT_TABLE_SHA256"),
        ("connection", "tunnel/connection.go", "PATCHED_CONNECTION_SHA256"),
        ("quic", "component/sniffer/quic_sniffer.go", "PATCHED_QUIC_SNIFFER_SHA256"),
        ("tproxy", "listener/tproxy/packet.go", "PATCHED_TPROXY_PACKET_SHA256"),
        ("dns", "dns/resolver.go", "PATCHED_DNS_RESOLVER_SHA256"),
        ("dns-server", "dns/server.go", "PATCHED_DNS_SERVER_SHA256"),
        ("doh", "dns/doh.go", "PATCHED_DNS_DOH_SHA256"),
        ("fetcher", "component/resource/fetcher.go", "PATCHED_PROVIDER_FETCHER_SHA256"),
        ("log", "log/log.go", "PATCHED_LOG_SHA256"),
        ("healthcheck", "adapter/provider/healthcheck.go", "PATCHED_PROVIDER_HEALTHCHECK_SHA256"),
        ("proxy-provider", "adapter/provider/provider.go", "PATCHED_PROXY_PROVIDER_SHA256"),
        ("client", "dns/client.go", "PATCHED_DNS_CLIENT_SHA256"),
        ("tls", "dns/dot.go", "PATCHED_DNS_TLS_SHA256"),
        ("dhcp", "dns/dhcp.go", "PATCHED_DNS_DHCP_SHA256"),
        ("util", "dns/util.go", "PATCHED_DNS_UTIL_SHA256"),
        ("dhcp-discovery", "component/dhcp/dhcp.go", "PATCHED_DHCP_DISCOVERY_SHA256"),
        ("ntp", "ntp/ntp/service.go", "PATCHED_NTP_SERVICE_SHA256"),
        ("socks5", "adapter/outbound/socks5.go", "PATCHED_SOCKS5_SHA256"),
        ("dns-outbound", "adapter/outbound/dns.go", "PATCHED_DNS_OUTBOUND_SHA256"),
    ]
    rels = [r for _, r, _ in entries]
    indices = {name:i for i,(name,_,_) in enumerate(entries)}
    pristine = {r: f"package {pathlib.Path(r).parent.name}\\n// pristine {r}\\n" for r in rels}
    final = {r: f"package {pathlib.Path(r).parent.name}\\n// final {r}\\n" for r in rels}
    for rel in rels:
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(pristine[rel])
    patch = root / "late-connections.patch"
    sections = ["".join(difflib.unified_diff(pristine[r].splitlines(True), final[r].splitlines(True), fromfile=r, tofile=r)) for r in rels]
    m.EXPECTED = {r:m.sha256(root/r) for r in rels}
    statistics = "package statistic\\n// statistics output\\n"
    m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(statistics.encode()).hexdigest()
    (root/rels[0]).write_text(statistics)
    sections[0] = "".join(difflib.unified_diff(statistics.splitlines(True), final[rels[0]].splitlines(True), fromfile=rels[0], tofile=rels[0]))
    for _,rel,name in entries: setattr(m,name,hashlib.sha256(final[rel].encode()).hexdigest())
    patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256=m.sha256(patch)
    if mode == "clean": pass
    elif mode == "all-final":
        for r in rels:(root/r).write_text(final[r])
    elif mode == "late-patch-tampered":
        patch.write_text(patch.read_text()+"tampered\\n")
    elif mode == "unknown-source-section":
        sections.append("--- unknown/source.go\\n+++ unknown/source.go\\n@@ -0,0 +1 @@\\n+unknown\\n")
        patch.write_text("".join(sections));m.LATE_CONNECTIONS_PATCH_SHA256=m.sha256(patch)
    elif mode == "partial-final-mixed": (root/rels[2]).write_text(final[rels[2]])
    else:
        if mode == "last-output-hash-error": index, fault = len(entries)-1, "output-hash-error"
        elif mode == "last-section-invalid": index, fault = len(entries)-1, "section-invalid"
        elif mode == "path-traversal-section": index, fault = indices["quic"], "path-traversal"
        else:
            faults = ["input-tampered", "output-hash-error", "partial-final-mixed", "path-traversal", "section-invalid"]
            fault = next(f for f in faults if mode.endswith("-"+f))
            index = indices[mode.removesuffix("-"+fault)]
        rel=rels[index]
        if fault == "input-tampered":(root/rel).write_text("wrong source\\n")
        elif fault == "output-hash-error":setattr(m,entries[index][2],"0"*64)
        elif fault == "partial-final-mixed":(root/rel).write_text(final[rel])
        elif fault == "path-traversal":
            sections[index]=sections[index].replace(f"--- {rel}\\n+++ {rel}\\n","--- ../escape.go\\n+++ ../escape.go\\n",1)
            patch.write_text("".join(sections));m.LATE_CONNECTIONS_PATCH_SHA256=m.sha256(patch)
        elif fault == "section-invalid":
            sections[index]=f"--- {rel}\\n+++ {rel}\\n@@ invalid\\nnot a patch\\n"
            patch.write_text("".join(sections));m.LATE_CONNECTIONS_PATCH_SHA256=m.sha256(patch)
    before={r:(root/r).read_bytes() for r in rels}
    try:m.apply_late(root);m.apply_late(root)
    except SystemExit:
        assert mode not in ("clean","all-final"),mode
        assert {r:(root/r).read_bytes() for r in rels}==before,"failed validation modified source"
    else:
        assert mode in ("clean","all-final"),"accepted incompatible patch: "+mode
        assert {r:(root/r).read_text() for r in rels}==final
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

for (const mode of ["clean", "exact-patched", "patch-tampered", "source-tampered", "output-mismatch", "invalid-patch"]) {
  test(`statistics patch application checks exact input and output: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); m.__file__ = str(root / "prepare-upstream.py")
    source = root / "tunnel/statistic/manager.go"; source.parent.mkdir(parents=True)
    pristine = "package statistic\\n\\n// pristine\\n"; adapted = "package statistic\\n\\n// joinable statistics\\n"; source.write_text(pristine)
    patch = root / "statistics.patch"; patch.write_text("".join(difflib.unified_diff(pristine.splitlines(True), adapted.splitlines(True), fromfile="a/tunnel/statistic/manager.go", tofile="b/tunnel/statistic/manager.go")))
    m.EXPECTED = {"tunnel/statistic/manager.go": m.sha256(source)}; m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(adapted.encode()).hexdigest()
    if mode == "invalid-patch": patch.write_text("not a patch\\n")
    m.STATISTICS_PATCH_SHA256 = m.sha256(patch)
    if mode == "exact-patched": source.write_text(adapted)
    elif mode == "patch-tampered": patch.write_text(patch.read_text() + "unreviewed\\n")
    elif mode == "source-tampered": source.write_text("wrong source\\n")
    elif mode == "output-mismatch": m.PATCHED_STATISTICS_SHA256 = "0" * 64
    before = source.read_bytes()
    try: m.apply_statistics(root); m.apply_statistics(root)
    except SystemExit:
        assert mode not in ("clean", "exact-patched"), mode; assert source.read_bytes() == before
    else: assert mode in ("clean", "exact-patched"), mode; assert source.read_text() == adapted
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
