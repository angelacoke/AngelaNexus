#!/usr/bin/env python3
"""Apply one reviewed patch to the exact pinned libXray / Xray-core pair."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

WRAPPER_COMMIT = "3c694b23290f9849fe52284a345ebd4343bc90cd"
CORE_COMMIT = "b26a91de4f3294e26a0ad0a970b81a386a41f789"
CORE_VERSION = "v1.260327.1-0.20260930074004-b26a91de4f32"
TOOLCHAIN = "go1.27.1"
HERE = Path(__file__).resolve().parent


def die(message: str) -> None:
    raise SystemExit(f"prepare-upstream: {message}")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def checked_path(root: Path, rel: str) -> Path:
    path = root / rel
    if not rel or Path(rel).is_absolute() or ".." in Path(rel).parts:
        die(f"invalid relative path: {rel}")
    if not path.resolve().is_relative_to(root.resolve()):
        die(f"path escapes source directory: {rel}")
    return path


def load_lock(path: Path) -> dict:
    data = json.loads(path.read_text())
    if data.get("version") != 1 or data.get("toolchain") != TOOLCHAIN:
        die("unsupported lock version/toolchain")
    if data.get("wrapper", {}).get("commit") != WRAPPER_COMMIT:
        die("wrapper commit is not pinned")
    if data.get("core", {}).get("commit") != CORE_COMMIT or data["core"].get("version") != CORE_VERSION:
        die("core commit/version is not pinned")
    for side in ("wrapper", "core"):
        if not data[side].get("files") or not data.get("tests", {}).get(side):
            die(f"empty source/test allow-list: {side}")
    return data


def check_files(root: Path, expected: dict, label: str) -> None:
    for rel, want in expected.items():
        path = checked_path(root, rel)
        if not path.is_file() or digest(path) != want:
            die(f"{label} hash mismatch: {rel}")


def verify_heads(lock: dict, wrapper: Path, core: Path) -> None:
    for side, root in (("wrapper", wrapper), ("core", core)):
        if git(root, "rev-parse", "HEAD") != lock[side]["commit"]:
            die(f"{side} HEAD mismatch")
    if core.resolve() != (wrapper.parent / "Xray-core").resolve():
        die("core must be the wrapper sibling named Xray-core")


def verify_prepared(lock: dict, wrapper: Path, core: Path) -> None:
    verify_heads(lock, wrapper, core)
    check_files(core, {r: s["after"] for r, s in lock["core"]["files"].items()}, "core output")
    wrapper_files = dict(lock["wrapper"]["files"])
    # The only admitted wrapper source edit is the exact local module replacement.
    pristine = subprocess.check_output(["git", "-C", str(wrapper), "show", "HEAD:go.mod"])
    current = (wrapper / "go.mod").read_bytes()
    if current not in (pristine, pristine + b"\nreplace github.com/xtls/xray-core => ../Xray-core\n"):
        die("wrapper go.mod differs from the reviewed local replacement")
    wrapper_files.pop("go.mod", None)
    check_files(wrapper, wrapper_files, "wrapper output")
    for side, root in (("wrapper", wrapper), ("core", core)):
        check_files(root, {r: s["sha256"] for r, s in lock["tests"][side].items()}, f"{side} test")
        allowed = set(lock[side]["files"]) if side == "core" else {"go.mod"}
        changed = set(git(root, "diff", "HEAD", "--name-only").splitlines())
        if not changed <= allowed:
            die(f"unexpected changed {side} source: {changed - allowed}")
        untracked = set(git(root, "ls-files", "--others").splitlines())
        # Upstream AAR/geo builds may create non-source outputs, never extra Go code.
        extra_go = {r for r in untracked if r.endswith((".go", ".mod", ".sum"))} - set(lock["tests"][side])
        if extra_go:
            die(f"unexpected untracked {side} source: {extra_go}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wrapper", type=Path, required=True)
    parser.add_argument("--core", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=HERE / "source-lock.json")
    parser.add_argument("--patch", type=Path, default=HERE / "core-lifecycle.patch")
    parser.add_argument("--verify-only", action="store_true", help="verify pristine inputs without applying")
    parser.add_argument("--verify-prepared", action="store_true")
    parser.add_argument("--provenance", type=Path)
    args = parser.parse_args()
    wrapper, core = args.wrapper.resolve(), args.core.resolve()
    lock = load_lock(args.lock)
    verify_heads(lock, wrapper, core)
    if not args.patch.is_file() or digest(args.patch) != lock["patch"]["sha256"]:
        die("patch missing or hash mismatch")
    # Authenticate all test inputs before mutating either source tree.
    for side in ("core", "wrapper"):
        check_files(HERE, {s["file"]: s["sha256"] for s in lock["tests"][side].values()}, f"reviewed {side} test")
    if args.verify_prepared:
        verify_prepared(lock, wrapper, core)
        return
    for root in (wrapper, core):
        if git(root, "status", "--porcelain", "--untracked-files=all"):
            die(f"unexpected dirty input checkout: {root}")
    check_files(wrapper, lock["wrapper"]["files"], "wrapper input")
    check_files(core, {r: s["before"] for r, s in lock["core"]["files"].items()}, "core input")
    if args.verify_only:
        return
    inputs = {"wrapper": dict(lock["wrapper"]["files"]), "core": {r: s["before"] for r, s in lock["core"]["files"].items()}}
    subprocess.run(["git", "apply", "--check", "--whitespace=error", str(args.patch.resolve())], cwd=core, check=True)
    subprocess.run(["git", "apply", "--whitespace=error", str(args.patch.resolve())], cwd=core, check=True)
    for side, root in (("core", core), ("wrapper", wrapper)):
        for rel, spec in lock["tests"][side].items():
            destination = checked_path(root, rel)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(checked_path(HERE, spec["file"]), destination)
    verify_prepared(lock, wrapper, core)
    if args.provenance:
        env = dict(os.environ, GOTOOLCHAIN=TOOLCHAIN)
        actual = subprocess.check_output(["go", "version"], text=True, env=env).strip()
        if actual.split()[2] != TOOLCHAIN:
            die(f"unexpected effective toolchain: {actual}")
        project = HERE.parents[2]
        provenance = {
            "version": 1, "kernel": "xray", "projectCommit": git(project, "rev-parse", "HEAD"),
            "wrapper": {k: lock["wrapper"][k] for k in ("repository", "commit") if k in lock["wrapper"]},
            "core": {k: lock["core"][k] for k in ("repository", "commit", "version") if k in lock["core"]},
            "patch": lock["patch"], "sourceLockSha256": digest(args.lock),
            "toolchain": {"requested": TOOLCHAIN, "actual": actual},
            "inputs": inputs,
            "outputs": {"core": {r: digest(core / r) for r in lock["core"]["files"]}},
            "tests": lock["tests"],
            "isolation": "separate Android process required; independent Go runtimes must not share a process",
        }
        args.provenance.parent.mkdir(parents=True, exist_ok=True)
        args.provenance.write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    main()
