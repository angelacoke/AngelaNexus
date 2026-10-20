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

// These tests exercise the real verification function against mocked git/module
// outputs; the actual pinned source and adapter output are tested in native CI.
for (const mode of ["clean", "exact-patched", "exact-statistics", "unexpected-file", "modified-source", "marker-only", "statistics-marker-only", "statistics-modified", "wrong-commit"]) {
  test(`owned-fd source verification is fail-closed: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import hashlib, importlib.util, json, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("owned_adapter", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    (root / ".git").mkdir()
    server = root / "listener/sing_tun/server.go"
    server.parent.mkdir(parents=True)
    server.write_text("pristine server\\n")
    statistics = root / "tunnel/statistic/manager.go"
    statistics.parent.mkdir(parents=True)
    statistics.write_text("pristine statistics\\n")
    (root / "go.mod").write_text("github.com/metacubex/sing-tun v0.4.27\\n")
    (root / "go.sum").write_text("github.com/metacubex/sing-tun v0.4.27 h1:fixture\\n")
    m.EXPECTED = {rel: m.sha256(root / rel) for rel in ("go.mod", "go.sum", "listener/sing_tun/server.go", "tunnel/statistic/manager.go")}
    module = root / "fixture-module"
    module.mkdir()
    (module / "tun_linux.go").write_text("func New(options Options) (Tun, error) {}\\n")
    m.SING_TUN_TUN_LINUX_SHA256 = m.sha256(module / "tun_linux.go")
    m.PATCHED_SERVER_SHA256 = hashlib.sha256(b"reviewed patch\\n").hexdigest()
    m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(b"reviewed statistics\\n").hexdigest()
    status = ""
    commit = m.COMMIT
    if mode == "exact-patched":
        server.write_text("reviewed patch\\n")
        status = " M listener/sing_tun/server.go\\n"
    elif mode == "exact-statistics":
        statistics.write_text("reviewed statistics\\n")
        status = " M tunnel/statistic/manager.go\\n"
    elif mode == "statistics-marker-only":
        statistics.write_text("func StopStatistics() {}\\n")
        status = " M tunnel/statistic/manager.go\\n"
    elif mode == "statistics-modified":
        statistics.write_text("modified statistics\\n")
    elif mode == "unexpected-file":
        status = "?? angelanexus_unreviewed.go\\n"
    elif mode == "modified-source":
        status = " M listener/sing_tun/server_notwindows.go\\n"
    elif mode == "marker-only":
        server.write_text("func NewWithOwnedFD() {}\\n")
        status = " M listener/sing_tun/server.go\\n"
    elif mode == "wrong-commit":
        commit = "0" * 40
    def output(command, **kwargs):
        if command[0] == "git":
            return commit if "rev-parse" in command else status
        return json.dumps({"Version": "v0.4.27", "Dir": str(module), "Sum": "h1:fixture"})
    m.subprocess.check_output = output
    try:
        m.verify_source(root)
    except SystemExit:
        if mode in ("clean", "exact-patched", "exact-statistics"):
            raise
    else:
        assert mode in ("clean", "exact-patched", "exact-statistics"), "accepted incompatible source: " + mode
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

for (const mode of ["clean", "exact-patched", "patch-tampered", "source-tampered", "output-mismatch", "invalid-patch"]) {
  test(`statistics patch application checks exact input and output: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    m.__file__ = str(root / "prepare-upstream.py")
    source = root / "tunnel/statistic/manager.go"
    source.parent.mkdir(parents=True)
    pristine = "package statistic\\n\\n// pristine\\n"
    adapted = "package statistic\\n\\n// joinable statistics\\n"
    source.write_text(pristine)
    patch = root / "statistics.patch"
    patch.write_text("".join(difflib.unified_diff(pristine.splitlines(True), adapted.splitlines(True), fromfile="a/tunnel/statistic/manager.go", tofile="b/tunnel/statistic/manager.go")))
    m.EXPECTED = {"tunnel/statistic/manager.go": m.sha256(source)}
    m.PATCHED_STATISTICS_SHA256 = hashlib.sha256(adapted.encode()).hexdigest()
    if mode == "invalid-patch":
        patch.write_text("not a patch\\n")
    m.STATISTICS_PATCH_SHA256 = m.sha256(patch)
    if mode == "exact-patched":
        source.write_text(adapted)
    elif mode == "patch-tampered":
        patch.write_text(patch.read_text() + "unreviewed\\n")
    elif mode == "source-tampered":
        source.write_text("wrong source\\n")
    elif mode == "output-mismatch":
        m.PATCHED_STATISTICS_SHA256 = "0" * 64
    before = source.read_bytes()
    try:
        m.apply_statistics(root)
        m.apply_statistics(root)
    except SystemExit:
        assert mode not in ("clean", "exact-patched"), mode
        assert source.read_bytes() == before, "failed verification modified source"
    else:
        assert mode in ("clean", "exact-patched"), mode
        assert source.read_text() == adapted
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
