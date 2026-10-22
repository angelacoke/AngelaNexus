#!/usr/bin/env python3
"""Verify actual debug APK bytes against the source-locked libXray AAR.

This is packaging evidence, not Android/JNI/device or release approval.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import zipfile

sys.dont_write_bytecode = True
ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
HERE = Path(__file__).resolve().parent


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def unique_archive(path):
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    require(len(names) == len(set(names)), f"duplicate ZIP entry: {path}")
    require(archive.testzip() is None, f"corrupt ZIP: {path}")
    return archive


def verify(apk, aar, provenance, expected_commit, repo):
    require(re.fullmatch(r"[0-9a-f]{40}", expected_commit), "expected commit must be a full SHA")
    bridge = repo / "native/android/xray-bridge"
    spec = importlib.util.spec_from_file_location("xray_artifact", bridge / "verify-artifact.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = json.loads(provenance.read_text())
    require(data.get("projectCommit") == expected_commit, "source project commit mismatch")
    lock_path = bridge / "source-lock.json"
    # Replay can run from a later packaging-only commit. Its source is the
    # explicitly selected immutable producer SHA, not the verifier's GITHUB_SHA.
    previous_sha = os.environ.get("GITHUB_SHA")
    try:
        os.environ["GITHUB_SHA"] = expected_commit
        module.validate_source(data, json.loads(lock_path.read_text()), lock_path)
    finally:
        if previous_sha is None:
            os.environ.pop("GITHUB_SHA", None)
        else:
            os.environ["GITHUB_SHA"] = previous_sha
    require(data.get("platform") == "android", "Android provenance required")
    require(data.get("abi") == "all", "aggregate Android AAR provenance required")
    toolchain = data.get("toolchain", {})
    require(toolchain.get("androidNdk") == "28.0.13004108", "NDK provenance mismatch")
    require(toolchain.get("gomobile") == "v0.0.0-20260908204917-8b95e45f8d3e", "gomobile provenance mismatch")
    require('"17.' in toolchain.get("java", ""), "Java 17 provenance required")
    aar_hash = digest(aar.read_bytes())
    require(data.get("artifact") == {"name": aar.name, "sha256": aar_hash}, "AAR provenance digest/name mismatch")
    post = data.get("postprocessing", {})
    require(post.get("operation") == "remove duplicate go/ Java classes" and post.get("outputSha256") == aar_hash,
            "deduplicated AAR provenance required")
    require(re.fullmatch(r"[0-9a-f]{64}", post.get("inputSha256", "")), "pre-deduplication digest missing")
    rows = []
    with unique_archive(aar) as source, unique_archive(apk) as package:
        # A file extension alone is not application-package evidence.
        require("AndroidManifest.xml" in package.namelist() and "classes.dex" in package.namelist(), "not an APK application")
        actual_paths = {n for n in package.namelist() if n.startswith("lib/") and n.endswith("/libgojni.so")}
        expected_paths = {f"lib/{abi}/libgojni.so" for abi in ABIS}
        require(actual_paths == expected_paths, "APK Xray ABI set mismatch")
        for abi, machine in zip(ABIS, (183, 40, 62)):
            aar_entry, apk_entry = f"jni/{abi}/libgojni.so", f"lib/{abi}/libgojni.so"
            original, packed = source.read(aar_entry), package.read(apk_entry)
            require(len(original) >= 20 and original[:4] == b"\x7fELF" and original[5] == 1,
                    f"invalid little-endian ELF: {abi}")
            require(int.from_bytes(original[18:20], "little") == machine, f"ELF machine mismatch: {abi}")
            require(original[4] == (1 if machine == 40 else 2), f"ELF class mismatch: {abi}")
            require(int.from_bytes(original[16:18], "little") == 3, f"ELF is not a shared object: {abi}")
            expected = digest(original)
            require(digest(packed) == expected, f"APK/AAR native SHA-256 mismatch: {abi}")
            # JNI shim presence is evidence of packaging only, never JNI execution.
            shim = f"lib/{abi}/libmihomo-jni.so"
            require(shim in package.namelist(), f"missing existing JNI shim: {abi}")
            rows.append({"abi": abi, "aarEntry": aar_entry, "apkEntry": apk_entry,
                         "sha256": expected, "elfMachine": machine,
                         "mihomoJniSha256": digest(package.read(shim)),
                         "mihomoCorePresent": f"lib/{abi}/libclash.so" in package.namelist()})
    return {"version": 1, "verified": True, "sourceCommit": expected_commit,
            "sourceLockSha256": digest(lock_path.read_bytes()),
            "aarSha256": aar_hash, "provenanceSha256": digest(provenance.read_bytes()),
            "apkSha256": digest(apk.read_bytes()), "libraries": rows,
            "scope": "Exact AAR-to-debug-APK Xray packaging only; not device/JNI/runtime, Mihomo core, signing or release acceptance."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--aar", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--repo-root", type=Path, default=HERE.parent)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    # Remove stale successful evidence before validation, including all failures.
    args.report.unlink(missing_ok=True)
    report = verify(args.apk, args.aar, args.provenance, args.expected_commit, args.repo_root)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
