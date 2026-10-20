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

// Exercise the real verification function with a complete seven-file pinned fixture.
for (const mode of ["clean", "exact-server", "exact-statistics", "exact-late", "marker-server", "modified-tracker", "unknown-dirty", "wrong-commit"]) {
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
      "tunnel/statistic/manager.go": "pristine manager\\n", "tunnel/statistic/tracker.go": "pristine tracker\\n", "tunnel/tunnel.go": "pristine tunnel\\n"}
    for rel, text in pristine.items():
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text)
    final = {"listener/sing_tun/server.go": "reviewed server\\n", "tunnel/statistic/manager.go": "reviewed manager\\n", "tunnel/statistic/tracker.go": "reviewed tracker\\n", "tunnel/tunnel.go": "reviewed tunnel\\n"}
    m.EXPECTED = {rel: m.sha256(root / rel) for rel in pristine}
    for rel, text in final.items():
        p = root / rel; p.write_text(text)
    m.PATCHED_SERVER_SHA256 = m.sha256(root / "listener/sing_tun/server.go")
    m.PATCHED_STATISTICS_SHA256 = m.sha256(root / "tunnel/statistic/manager.go")
    m.PATCHED_LATE_MANAGER_SHA256 = m.PATCHED_STATISTICS_SHA256
    m.PATCHED_TRACKER_SHA256 = m.sha256(root / "tunnel/statistic/tracker.go")
    m.PATCHED_TUNNEL_SHA256 = m.sha256(root / "tunnel/tunnel.go")
    for rel in final: (root / rel).write_text(pristine[rel])
    status = ""; commit = m.COMMIT
    if mode == "exact-server":
        (root / "listener/sing_tun/server.go").write_text(final["listener/sing_tun/server.go"]); status = " M listener/sing_tun/server.go\\n"
    elif mode == "exact-statistics":
        (root / "tunnel/statistic/manager.go").write_text(final["tunnel/statistic/manager.go"]); status = " M tunnel/statistic/manager.go\\n"
    elif mode == "exact-late":
        for rel in ("tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go"): (root / rel).write_text(final[rel])
        status = " M tunnel/statistic/manager.go\\n M tunnel/statistic/tracker.go\\n M tunnel/tunnel.go\\n"
    elif mode == "marker-server":
        (root / "listener/sing_tun/server.go").write_text("func NewWithOwnedFD() {}\\n"); status = " M listener/sing_tun/server.go\\n"
    elif mode == "modified-tracker":
        (root / "tunnel/statistic/tracker.go").write_text("modified tracker\\n"); status = " M tunnel/statistic/tracker.go\\n"
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
        assert mode not in ("clean", "exact-server", "exact-statistics", "exact-late"), mode
    else: assert mode in ("clean", "exact-server", "exact-statistics", "exact-late"), "accepted incompatible source: " + mode
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

// Directly exercise the three-file late patch. Every rejected input/output/path
// must leave all three upstream files byte-for-byte untouched.
for (const mode of ["clean", "all-final", "late-patch-tampered", "manager-input-tampered", "tracker-input-tampered", "tunnel-input-tampered", "last-output-hash-error", "last-section-invalid", "path-traversal-section", "partial-final-mixed"]) {
  test(`late patch application is exact and atomic: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); m.__file__ = str(root / "prepare-upstream.py")
    rels = ["tunnel/statistic/manager.go", "tunnel/statistic/tracker.go", "tunnel/tunnel.go"]
    pristine = {rels[0]: "package statistic\\n// pristine manager\\n", rels[1]: "package statistic\\n// pristine tracker\\n", rels[2]: "package tunnel\\n// pristine tunnel\\n"}
    final = {rels[0]: "package statistic\\n// final manager\\n", rels[1]: "package statistic\\n// final tracker\\n", rels[2]: "package tunnel\\n// final tunnel\\n"}
    for rel in rels:
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(pristine[rel])
    patch = root / "late-connections.patch"
    sections = ["".join(difflib.unified_diff(pristine[r].splitlines(True), final[r].splitlines(True), fromfile=r, tofile=r)) for r in rels]
    patch.write_text("".join(sections))
    m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    m.EXPECTED = {r: m.sha256(root / r) for r in rels}
    m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(b"package statistic\\n// statistics output\\n").hexdigest()
    # Late application starts after statistics.patch: manager is its statistics output.
    (root / rels[0]).write_text("package statistic\\n// statistics output\\n")
    m.PATCHED_LATE_MANAGER_SHA256 = hashlib.sha256(final[rels[0]].encode()).hexdigest()
    m.PATCHED_TRACKER_SHA256 = hashlib.sha256(final[rels[1]].encode()).hexdigest()
    m.PATCHED_TUNNEL_SHA256 = hashlib.sha256(final[rels[2]].encode()).hexdigest()
    m.EXPECTED[rels[0]] = m.sha256(root / rels[0])
    # Generate manager section from the actual statistics output so patching is valid.
    sections[0] = "".join(difflib.unified_diff((root / rels[0]).read_text().splitlines(True), final[rels[0]].splitlines(True), fromfile=rels[0], tofile=rels[0]))
    patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    if mode == "all-final":
        for r in rels: (root / r).write_text(final[r])
    elif mode == "late-patch-tampered": patch.write_text(patch.read_text() + "tampered\\n"); m.LATE_CONNECTIONS_PATCH_SHA256 = "0" * 64
    elif mode == "manager-input-tampered": (root / rels[0]).write_text("wrong manager\\n")
    elif mode == "tracker-input-tampered": (root / rels[1]).write_text("wrong tracker\\n")
    elif mode == "tunnel-input-tampered": (root / rels[2]).write_text("wrong tunnel\\n")
    elif mode == "last-output-hash-error": m.PATCHED_TUNNEL_SHA256 = "0" * 64
    elif mode == "last-section-invalid":
        sections[2] = "--- tunnel/tunnel.go\\n+++ tunnel/tunnel.go\\n@@ invalid\\nnot a patch\\n"; patch.write_text(sections[0] + sections[1] + sections[2]); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode == "path-traversal-section":
        sections[2] = sections[2].replace("--- tunnel/tunnel.go\\n+++ tunnel/tunnel.go\\n", "--- ../escape.go\\n+++ ../escape.go\\n", 1); patch.write_text("".join(sections)); m.LATE_CONNECTIONS_PATCH_SHA256 = m.sha256(patch)
    elif mode == "partial-final-mixed":
        (root / rels[2]).write_text(final[rels[2]])
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
