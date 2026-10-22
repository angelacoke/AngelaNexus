#!/usr/bin/env python3
"""Fail-closed preparation and verification of controlled Mihomo debug packaging.

The project checkout SHA is distinct from the pinned upstream Mihomo commit.
This proves selected build bytes, not runtime behavior or release approval.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
MACHINES = dict(zip(ABIS, (183, 40, 62)))
CLASSES = dict(zip(ABIS, (2, 1, 2)))
SYMBOLS = ("angelaInit", "angelaApplyConfig", "startTUN", "angelaStopTun",
           "stopTun", "updateDns", "suspend", "forceGC", "getTraffic",
           "getTotalTraffic", "freeCString")
SHIM_SYMBOLS = ("JNI_OnLoad", "angelanexus_protect_fd") + tuple(
    "Java_app_angelanexus_MihomoJniNativeHost_" + method
    for method in ("nativeInitialize", "nativeApplyConfig", "nativeSetVpnService",
                   "nativeHasVpnProtector", "nativeStartTun", "nativeStopTun",
                   "nativeUpdateDns", "nativeSetSuspended", "nativeInvokeMethod",
                   "nativeSetEventListener", "nativeForceGc", "nativeGetTraffic",
                   "nativeGetTotalTraffic")
)
WORKFLOW = ".github/workflows/mihomo-android-native-build.yml"
MANIFEST = "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"
COMPLIANCE = "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json"
SCOPE = ("Exact selected-build Mihomo core bytes in controlled debug APK, with separate "
         "JNI shim packaging; not independent reproducibility, AAB, device/JNI execution, "
         "VPN traffic, signing, release or distribution acceptance.")


class EvidenceError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise EvidenceError(message)


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    return digest_bytes(path.read_bytes())


def json_file(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(value, dict), f"JSON object required: {path}")
    return value


def full_sha(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "full lowercase source SHA required")
    return value


def validate_run(run, source_commit, run_id=None):
    full_sha(source_commit)
    owner = os.environ.get("GITHUB_REPOSITORY")
    require(owner, "GITHUB_REPOSITORY is required")
    require(isinstance(run, dict), "GitHub run metadata must be an object")
    for key in ("repository", "head_repository"):
        require(isinstance(run.get(key), dict) and run[key].get("full_name") == owner,
                "source-run repository/head_repository mismatch")
    expected = {"head_sha": source_commit, "status": "completed", "conclusion": "success", "path": WORKFLOW}
    for key, value in expected.items():
        require(run.get(key) == value, f"source-run metadata mismatch: {key}")
    require(run.get("event") in ("push", "workflow_dispatch"), "source-run event must be direct checkout, never PR")
    actual_id = run.get("id")
    require(type(actual_id) is int and actual_id > 0, "source-run immutable id is missing or invalid")
    if run_id is not None:
        require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id), "run ID must be numeric and immutable")
        require(str(actual_id) == run_id, "source-run immutable id mismatch")
    return owner


def elf_info(path, abi, symbols=SYMBOLS):
    # Read numeric ELF identity directly, independent of readelf's locale/labels.
    data = path.read_bytes()
    require(len(data) >= 20 and data[:4] == b"\x7fELF" and data[5] == 1,
            f"invalid little-endian ELF: {abi}")
    require(data[4] == CLASSES[abi], f"ELF class mismatch: {abi}")
    require(int.from_bytes(data[16:18], "little") == 3, f"ELF is not ET_DYN: {abi}")
    require(int.from_bytes(data[18:20], "little") == MACHINES[abi], f"ELF machine mismatch: {abi}")
    subprocess.run(["readelf", "-h", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    output = subprocess.check_output(["nm", "-D", "--defined-only", str(path)], text=True)
    exported = {fields[-1] for line in output.splitlines()
                if len(fields := line.split()) >= 3 and fields[-2] in ("T", "W", "t", "w")}
    missing = set(symbols) - exported
    require(not missing, f"{abi} missing required function exports: {', '.join(sorted(missing))}")
    return {"class": CLASSES[abi], "machine": MACHINES[abi], "requiredExports": list(symbols)}


def verified_artifacts(artifacts, repo, expected):
    # Keep the full reviewed native verifier and every fixed hash gate intact.
    spec = importlib.util.spec_from_file_location("mihomo_native_verifier", HERE / "verify-mihomo-native-artifacts.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.verify(artifacts, repo)
    rows = {}
    for abi in ABIS:
        provenance = artifacts / abi / f"mihomo-provenance-{abi}.json"
        record = json_file(provenance)
        require(record.get("projectCommit") == expected, f"provenance {abi} projectCommit mismatch")
        source = artifacts / abi / f"libclash-{abi}.so"
        rows[abi] = {"sourceSha256": digest(source), "provenanceSha256": digest(provenance),
                     "elf": elf_info(source, abi), "role": "core"}
    return rows


def prepare(args):
    full_sha(args.source_commit)
    require(re.fullmatch(r"[1-9][0-9]*", args.run_id), "run ID must be numeric and immutable")
    out, repo = args.output.resolve(), args.repo_root.resolve()
    require(not out.exists() or (out.is_dir() and not any(out.iterdir())), "output directory must be empty")
    owner = os.environ.get("GITHUB_REPOSITORY")
    require(owner, "GITHUB_REPOSITORY is required")
    run = json.loads(subprocess.check_output(["gh", "api", f"repos/{owner}/actions/runs/{args.run_id}"], text=True))
    validate_run(run, args.source_commit, args.run_id)
    out.mkdir(parents=True, exist_ok=True)
    (out / "source-run.json").write_text(json.dumps(run, indent=2, sort_keys=True) + "\n")
    artifacts = out / "artifacts"
    for abi in ABIS:
        target = artifacts / abi
        target.mkdir(parents=True)
        subprocess.run(["gh", "run", "download", args.run_id, "--repo", owner,
                        "--name", f"mihomo-v1.19.32-{abi}", "--dir", str(target)], check=True)
        # Original verifier rejects unexpected entries; never hide extras by finding
        # an arbitrary .so, renaming unknown files or discarding download contents.
    rows = verified_artifacts(artifacts, repo, args.source_commit)
    for abi in ABIS:
        target = out / "jniLibs" / abi / "libclash.so"
        target.parent.mkdir(parents=True)
        shutil.copyfile(artifacts / abi / f"libclash-{abi}.so", target)
        rows[abi]["installedSha256"] = digest(target)
        require(rows[abi]["installedSha256"] == rows[abi]["sourceSha256"], f"source/install copy mismatch: {abi}")
    report = {"version": 1, "verified": True, "sourceCommit": args.source_commit,
              "runId": args.run_id, "runMetadataSha256": digest(out / "source-run.json"),
              "manifestSha256": digest(repo / MANIFEST), "complianceSha256": digest(repo / COMPLIANCE),
              "libraries": rows, "scope": SCOPE}
    (out / "preparation-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))


def verify(args):
    args.report.unlink(missing_ok=True)
    expected = full_sha(args.expected_commit)
    evidence, repo = args.evidence_root.resolve(), args.repo_root.resolve()
    run = json_file(evidence / "source-run.json")
    prep = json_file(evidence / "preparation-report.json")
    validate_run(run, expected, prep.get("runId"))
    require(prep.get("verified") is True and prep.get("sourceCommit") == expected, "preparation source binding mismatch")
    require(prep.get("runMetadataSha256") == digest(evidence / "source-run.json"), "source-run metadata hash mismatch")
    for key, path in (("manifestSha256", MANIFEST), ("complianceSha256", COMPLIANCE)):
        require(prep.get(key) == digest(repo / path), f"preparation {key} mismatch")
    artifacts = evidence / "artifacts"
    rows = verified_artifacts(artifacts, repo, expected)
    for abi in ABIS:
        installed = evidence / "jniLibs" / abi / "libclash.so"
        rows[abi]["installedSha256"] = digest(installed)
        require(rows[abi]["installedSha256"] == rows[abi]["sourceSha256"], f"source/jni hash mismatch: {abi}")
    with zipfile.ZipFile(args.apk) as package:
        names = package.namelist()
        require(len(names) == len(set(names)), "duplicate ZIP entry")
        require(package.testzip() is None, "corrupt APK ZIP")
        require("AndroidManifest.xml" in names and "classes.dex" in names, "not an APK application")
        for library in ("libclash.so", "libmihomo-jni.so"):
            actual = {n for n in names if n.startswith("lib/") and n.endswith("/" + library)}
            require(actual == {f"lib/{abi}/{library}" for abi in ABIS}, f"APK {library} ABI set mismatch")
        for abi in ABIS:
            core = package.read(f"lib/{abi}/libclash.so")
            require(digest_bytes(core) == rows[abi]["sourceSha256"], f"APK/source hash mismatch: {abi}")
            shim = package.read(f"lib/{abi}/libmihomo-jni.so")
            require(digest_bytes(shim) != digest_bytes(core), f"shim is identical to core: {abi}")
            with tempfile.NamedTemporaryFile() as temp:
                temp.write(shim)
                temp.flush()
                shim_elf = elf_info(Path(temp.name), abi, SHIM_SYMBOLS)
            rows[abi].update({"apkEntry": f"lib/{abi}/libclash.so", "apkSha256": digest_bytes(core),
                              "shimSha256": digest_bytes(shim), "shimElf": shim_elf, "shimRole": "JNI bridge, not core"})
    report = {"version": 1, "verified": True, "sourceCommit": expected, "runId": str(run["id"]),
              "runMetadataSha256": digest(evidence / "source-run.json"),
              "manifestSha256": digest(repo / MANIFEST), "complianceSha256": digest(repo / COMPLIANCE),
              "preparationReportSha256": digest(evidence / "preparation-report.json"),
              "apkSha256": digest(args.apk), "libraries": rows, "scope": SCOPE}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--run-id", required=True)
    prep.add_argument("--source-commit", required=True)
    prep.add_argument("--output", type=Path, required=True)
    prep.add_argument("--repo-root", type=Path, default=HERE.parent)
    prep.set_defaults(fn=prepare)
    check = sub.add_parser("verify")
    check.add_argument("--apk", type=Path, required=True)
    check.add_argument("--evidence-root", type=Path, required=True)
    check.add_argument("--expected-commit", required=True)
    check.add_argument("--repo-root", type=Path, default=HERE.parent)
    check.add_argument("--report", type=Path, required=True)
    check.set_defaults(fn=verify)
    args = parser.parse_args()
    try:
        args.fn(args)
    except Exception as exc:
        print(f"Mihomo debug evidence FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
