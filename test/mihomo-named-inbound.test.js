import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const adapter = new URL("../native/android/mihomo-bridge/prepare-upstream.py", import.meta.url);
const modes = ["clean", "all-final", "patch-tampered", "mixed-input", "listener-input", "helper-exists", "partial-final", "unknown-section", ...[0, 1, 2].flatMap(i => [`output-${i}`, `path-${i}`, `invalid-${i}`])];
for (const mode of modes) {
  test(`named inbound patch is exact, atomic and fail-closed: ${mode}`, () => {
    const result = spawnSync("python3", ["-B", "-c", `
import difflib, hashlib, importlib.util, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location("adapter", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
mode = sys.argv[2]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp); m.__file__ = str(root / "prepare-upstream.py")
    rels = ["listener/inbound/mixed.go", "listener/listener.go", "listener/inbound/mixed_lifecycle.go"]
    inputs = ["package inbound\\n// pinned mixed\\n", "package listener\\n// reviewed default mixed intermediate\\n", ""]
    outputs = ["package inbound\\n// reviewed named mixed\\n", "package listener\\n// reviewed named rebuild\\n", "package inbound\\n// reviewed named owner\\n"]
    constants = ["PATCHED_NAMED_MIXED_SHA256", "PATCHED_NAMED_LISTENER_SHA256", "PATCHED_NAMED_MIXED_REGISTRY_SHA256"]
    digest = lambda s: hashlib.sha256(s.encode()).hexdigest()
    m.EXPECTED = {rels[0]:digest(inputs[0])}; m.PATCHED_LISTENER_SHA256 = digest(inputs[1])
    sections = []
    for i, rel in enumerate(rels):
        path = root / rel; path.parent.mkdir(parents=True, exist_ok=True)
        if i != 2: path.write_text(inputs[i])
        setattr(m, constants[i], digest(outputs[i]))
        sections.append("".join(difflib.unified_diff(inputs[i].splitlines(True), outputs[i].splitlines(True), fromfile=rel, tofile=rel)))
    if mode.startswith("path-"):
        i = int(mode[-1]); sections[i] = sections[i].replace("+++ " + rels[i], "+++ ../../escape.go", 1)
    if mode.startswith("invalid-"):
        i = int(mode[-1]); sections[i] = sections[i].split("@@", 1)[0] + "invalid hunk\\n"
    if mode == "unknown-section": sections.append("--- extra.go\\n+++ extra.go\\n@@ -0,0 +1 @@\\n+package extra\\n")
    patch = root / "named-inbound-lifecycle.patch"; patch.write_text("".join(sections)); m.NAMED_INBOUND_LIFECYCLE_PATCH_SHA256 = m.sha256(patch)
    if mode == "patch-tampered": patch.write_text(patch.read_text() + "unreviewed\\n")
    if mode == "mixed-input": (root / rels[0]).write_text("tampered input\\n")
    if mode == "listener-input": (root / rels[1]).write_text("tampered intermediate\\n")
    if mode == "helper-exists": (root / rels[2]).write_text("unexpected helper\\n")
    if mode == "partial-final": (root / rels[0]).write_text(outputs[0])
    if mode.startswith("output-"): setattr(m, constants[int(mode[-1])], "0" * 64)
    if mode == "all-final":
        for rel, text in zip(rels, outputs): (root / rel).write_text(text)
    before = {r:(root / r).read_bytes() if (root / r).exists() else None for r in rels}
    try: m.apply_named(root); m.apply_named(root)
    except SystemExit:
        assert mode not in ("clean", "all-final"), mode
        assert before == {r:(root / r).read_bytes() if (root / r).exists() else None for r in rels}, "rejected patch partially changed sources"
        assert not (root.parent / "escape.go").exists()
    else:
        assert mode in ("clean", "all-final"), "accepted unreviewed named adapter: " + mode
        assert all((root / rel).read_text() == text for rel, text in zip(rels, outputs))
`, adapter.pathname, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
