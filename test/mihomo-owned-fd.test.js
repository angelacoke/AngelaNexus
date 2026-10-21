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
for (const mode of ["clean", "exact-fetcher", "modified-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-server", "exact-statistics", "exact-late", "exact-quic", "marker-server", "modified-tracker", "modified-nat", "modified-connection", "modified-quic", "exact-tproxy", "modified-tproxy", "modified-dns", "modified-doh", "modified-dns-server", "unknown-dirty", "wrong-commit"]) {
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
      "tunnel/statistic/manager.go": "pristine manager\\n", "tunnel/statistic/tracker.go": "pristine tracker\\n", "tunnel/tunnel.go": "pristine tunnel\\n", "component/nat/table.go": "pristine nat\\n", "tunnel/connection.go": "pristine connection\\n", "component/sniffer/quic_sniffer.go": "pristine QUIC\\n", "listener/tproxy/packet.go": "pristine TProxy packet\\n", "dns/resolver.go": "pristine DNS resolver\\n", "dns/server.go": "pristine DNS server\\n", "dns/doh.go": "pristine DNS DoH\\n", "component/resource/fetcher.go": "pristine fetcher\\n", "log/log.go": "pristine log\\n", "adapter/provider/healthcheck.go": "pristine healthcheck\\n", "adapter/provider/provider.go": "pristine provider\\n"}
    for rel, text in pristine.items():
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
    final = {"listener/sing_tun/server.go": "reviewed server\\n", "tunnel/statistic/manager.go": "reviewed manager\\n", "tunnel/statistic/tracker.go": "reviewed tracker\\n", "tunnel/tunnel.go": "reviewed tunnel\\n", "component/nat/table.go": "reviewed nat\\n", "tunnel/connection.go": "reviewed connection\\n", "component/sniffer/quic_sniffer.go": "reviewed QUIC\\n", "listener/tproxy/packet.go": "reviewed TProxy packet\\n", "dns/resolver.go": "reviewed DNS resolver\\n", "dns/server.go": "reviewed DNS server\\n", "dns/doh.go": "reviewed DNS DoH\\n", "component/resource/fetcher.go": "reviewed fetcher\\n", "log/log.go": "reviewed log\\n", "adapter/provider/healthcheck.go": "reviewed healthcheck\\n", "adapter/provider/provider.go": "reviewed provider\\n"}
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
        assert mode not in ("clean", "exact-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-server", "exact-statistics", "exact-late", "exact-quic", "exact-tproxy"), mode
    else: assert mode in ("clean", "exact-fetcher", "exact-dns", "exact-doh", "exact-dns-server", "exact-server", "exact-statistics", "exact-late", "exact-quic", "exact-tproxy"), "accepted incompatible source: " + mode
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

// Directly exercise the thirteen-file late patch. Every rejected input/output/path
// must leave all thirteen upstream files byte-for-byte untouched.
for (const mode of ["clean", "all-final", "late-patch-tampered", "manager-input-tampered", "tracker-input-tampered", "tunnel-input-tampered", "nat-input-tampered", "connection-input-tampered", "quic-input-tampered", "quic-partial-final-mixed", "tproxy-input-tampered", "dns-input-tampered", "dns-server-input-tampered", "doh-input-tampered", "dns-output-hash-error", "dns-server-output-hash-error", "doh-output-hash-error", "fetcher-input-tampered", "fetcher-output-hash-error", "fetcher-partial-final-mixed", "fetcher-path-traversal", "fetcher-section-invalid", "log-input-tampered", "log-output-hash-error", "log-path-traversal", "log-section-invalid", "healthcheck-input-tampered", "healthcheck-output-hash-error", "healthcheck-partial-final-mixed", "healthcheck-path-traversal", "healthcheck-section-invalid", "proxy-provider-input-tampered", "proxy-provider-output-hash-error", "proxy-provider-partial-final-mixed", "proxy-provider-path-traversal", "proxy-provider-section-invalid", "unknown-source-section", "tproxy-output-hash-error", "connection-output-hash-error", "nat-output-hash-error", "last-output-hash-error", "last-section-invalid", "path-traversal-section", "partial-final-mixed", "dns-server-partial-final-mixed", "dns-server-path-traversal", "dns-server-section-invalid", "doh-partial-final-mixed", "doh-path-traversal", "doh-section-invalid"]) {
  test(`late patch application is exact and atomic: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); m.__file__ = str(root / "prepare-upstream.py")
    rels = ["tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go", "component/nat/table.go", "tunnel/connection.go", "component/sniffer/quic_sniffer.go", "listener/tproxy/packet.go", "dns/resolver.go", "dns/server.go", "dns/doh.go", "component/resource/fetcher.go", "log/log.go", "adapter/provider/healthcheck.go", "adapter/provider/provider.go"]
    labels = ["manager", "tracker", "tunnel", "NAT", "connection", "quic", "packet", "resolver", "DNS server", "DNS DoH", "fetcher", "log", "healthcheck", "provider"]
    packages = ["statistic", "statistic", "tunnel", "nat", "tunnel", "sniffer", "tproxy", "dns", "dns", "dns", "resource", "log", "provider", "provider"]
    pristine = {r: f"package {packages[i]}\\n// pristine {labels[i]}\\n" for i, r in enumerate(rels)}
    final = {r: f"package {packages[i]}\\n// final {labels[i]}\\n" for i, r in enumerate(rels)}
    for rel in rels:
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(pristine[rel])
    patch = root / "late-connections.patch"
    sections = ["".join(difflib.unified_diff(pristine[r].splitlines(True), final[r].splitlines(True), fromfile=r, tofile=r)) for r in rels]
    patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    m.EXPECTED = {r: m.sha256(root / r) for r in rels}
    m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(b"package statistic\\n// statistics output\\n").hexdigest()
    # Late application starts after statistics.patch: manager is its statistics output.
    (root / rels[0]).write_text("package statistic\\n// statistics output\\n")
    hashes = ["PATCHED_LATE_MANAGER_SHA256", "PATCHED_TRACKER_SHA256", "PATCHED_TUNNEL_SHA256", "PATCHED_NAT_TABLE_SHA256", "PATCHED_CONNECTION_SHA256", "PATCHED_QUIC_SNIFFER_SHA256", "PATCHED_TPROXY_PACKET_SHA256", "PATCHED_DNS_RESOLVER_SHA256", "PATCHED_DNS_SERVER_SHA256", "PATCHED_DNS_DOH_SHA256", "PATCHED_PROVIDER_FETCHER_SHA256", "PATCHED_LOG_SHA256", "PATCHED_PROVIDER_HEALTHCHECK_SHA256", "PATCHED_PROXY_PROVIDER_SHA256"]
    for name, rel in zip(hashes, rels): setattr(m, name, hashlib.sha256(final[rel].encode()).hexdigest())
    m.EXPECTED[rels[0]] = m.sha256(root / rels[0])
    # Generate manager section from the actual statistics output so patching is valid.
    sections[0] = "".join(difflib.unified_diff((root / rels[0]).read_text().splitlines(True), final[rels[0]].splitlines(True), fromfile=rels[0], tofile=rels[0]))
    patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    if mode == "all-final":
        for r in rels: (root / r).write_text(final[r])
    elif mode == "late-patch-tampered": patch.write_text(patch.read_text() + "tampered\\n"); m.LATE_CONNECTIONS_PATCH_SHA256 = "0" * 64
    elif mode == "last-output-hash-error": m.PATCHED_QUIC_SNIFFER_SHA256 = "0" * 64
    elif mode == "last-section-invalid":
        sections[5] = "--- component/sniffer/quic_sniffer.go\\n+++ component/sniffer/quic_sniffer.go\\n@@ invalid\\nnot a patch\\n"; patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode.endswith("-input-tampered"):
        prefix = mode.removesuffix("-input-tampered")
        index = {"manager": 0, "tracker": 1, "tunnel": 2, "nat": 3, "connection": 4, "quic": 5, "tproxy": 6, "dns": 7, "dns-server": 8, "doh": 9, "fetcher": 10, "log": 11, "healthcheck": 12, "proxy-provider": 13}[prefix]
        (root / rels[index]).write_text("wrong " + prefix + "\\n")
    elif mode.endswith("-output-hash-error"):
        prefix = mode.removesuffix("-output-hash-error")
        index = {"dns": 7, "dns-server": 8, "doh": 9, "fetcher": 10, "log": 11, "healthcheck": 12, "proxy-provider": 13, "connection": 4, "nat": 3, "quic": 5, "tproxy": 6}[prefix]
        setattr(m, hashes[index], "0" * 64)
    elif mode.endswith("-partial-final-mixed"):
        prefix = mode.removesuffix("-partial-final-mixed")
        index = {"dns-server": 8, "doh": 9, "fetcher": 10, "healthcheck": 12, "proxy-provider": 13, "quic": 5}[prefix]
        (root / rels[index]).write_text(final[rels[index]])
    elif mode.endswith("-path-traversal"):
        prefix = mode.removesuffix("-path-traversal")
        index = {"dns-server": 8, "doh": 9, "fetcher": 10, "log": 11, "healthcheck": 12, "proxy-provider": 13}[prefix]
        sections[index] = sections[index].replace(f"--- {rels[index]}\\n+++ {rels[index]}\\n", "--- ../escape.go\\n+++ ../escape.go\\n", 1); patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode.endswith("-section-invalid"):
        prefix = mode.removesuffix("-section-invalid")
        index = {"dns-server": 8, "doh": 9, "fetcher": 10, "log": 11, "healthcheck": 12, "proxy-provider": 13}[prefix]
        sections[index] = f"--- {rels[index]}\\n+++ {rels[index]}\\n@@ invalid\\nnot a patch\\n"; patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode == "unknown-source-section":
        sections.append("--- unknown/source.go\\n+++ unknown/source.go\\n@@ -0,0 +1 @@\\n+unknown\\n"); patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode == "path-traversal-section":
        sections[5] = sections[5].replace("--- component/sniffer/quic_sniffer.go\\n+++ component/sniffer/quic_sniffer.go\\n", "--- ../escape.go\\n+++ ../escape.go\\n", 1); patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode == "partial-final-mixed": (root / rels[2]).write_text(final[rels[2]])
    before = {r: (root / r).read_bytes() for r in rels}
    try:
        m.apply_late(root); m.apply_late(root)
    except SystemExit:
        assert mode not in ("clean", "all-final"), mode
        assert {r: (root / r).read_bytes() for r in rels} == before, "failed late verification modified source"
    else:
        assert mode in ("clean", "all-final"), mode
        assert {r: (root / r).read_text() for r in rels} == final
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
