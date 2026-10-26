#!/usr/bin/env python3
"""Verify/stamp an AAR against its controlled source and final archive digest."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(value: bool, message: str) -> None:
    if not value:
        raise SystemExit(message)


def validate_source(data: dict, lock: dict, lock_path: Path) -> None:
    require(data.get("version") == lock["version"], "provenance version mismatch")
    require(data.get("kernel") == "xray", "provenance kernel mismatch")
    require(data.get("sourceLockSha256") == digest(lock_path), "source lock hash mismatch")
    for side in ("wrapper", "core"):
        for key in ("repository", "commit", "version"):
            if key in lock[side]:
                require(data.get(side, {}).get(key) == lock[side][key], f"{side} {key} mismatch")
        for rel, spec in lock[side]["files"].items():
            expected = spec["before"] if isinstance(spec, dict) else spec
            require(data.get("inputs", {}).get(side, {}).get(rel) == expected, f"input hash mismatch: {side}/{rel}")
    require(data.get("patch") == lock["patch"], "patch provenance mismatch")
    require(data.get("tests") == lock["tests"], "test provenance mismatch")
    for rel, spec in lock["core"]["files"].items():
        require(data.get("outputs", {}).get("core", {}).get(rel) == spec["after"], f"output hash mismatch: {rel}")
    toolchain = data.get("toolchain", {})
    require(toolchain.get("requested") == lock["toolchain"], "requested toolchain mismatch")
    require(toolchain.get("actual", "").startswith(f"go version {lock['toolchain']} "), "effective toolchain mismatch")
    require(bool(data.get("projectCommit")), "missing project commit")
    if os.environ.get("GITHUB_SHA"):
        require(data["projectCommit"] == os.environ["GITHUB_SHA"], "project commit mismatch")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=HERE / "source-lock.json")
    parser.add_argument("--stamp", action="store_true", help="record a new/final archive digest after source validation")
    parser.add_argument("--android", action="store_true", help="record and verify actual Android build toolchain")
    parser.add_argument("--abi", default="all")
    parser.add_argument("--deduplicated", action="store_true")
    args = parser.parse_args()
    data = json.loads(args.provenance.read_text())
    lock = json.loads(args.lock.read_text())
    validate_source(data, lock, args.lock)
    require(args.artifact.is_file() and args.artifact.stat().st_size > 0, "artifact missing/empty")
    with zipfile.ZipFile(args.artifact) as archive:
        require(archive.testzip() is None, "corrupt AAR ZIP")
        require("classes.jar" in archive.namelist(), "AAR lacks classes.jar")
    actual = digest(args.artifact)
    if args.stamp:
        previous = data.get("artifact", {}).get("sha256")
        data["artifact"] = {"name": args.artifact.name, "sha256": actual}
        if args.android:
            ndk = Path(os.environ["ANDROID_NDK_HOME"]) / "source.properties"
            properties = dict(line.split("=", 1) for line in ndk.read_text().splitlines() if "=" in line)
            revision = next((v.strip() for k, v in properties.items() if k.strip() == "Pkg.Revision"), "")
            require(revision == "28.0.13004108", "NDK revision mismatch")
            java = subprocess.check_output(["java", "-version"], stderr=subprocess.STDOUT, text=True).splitlines()[0]
            require('"17.' in java, "Java 17 required")
            gomobile = os.environ.get("LIBXRAY_GOMOBILE_VERSION")
            require(gomobile == "v0.0.0-20260908204917-8b95e45f8d3e", "gomobile pin mismatch")
            data["toolchain"].update({"java": java, "androidNdk": revision, "gomobile": gomobile})
            data.update({"platform": "android", "abi": args.abi})
        if args.deduplicated:
            require(bool(previous), "missing pre-deduplication artifact digest")
            data["postprocessing"] = {"operation": "remove duplicate go/ Java classes", "inputSha256": previous, "outputSha256": actual}
        args.provenance.write_text(json.dumps(data, indent=2) + "\n")
    require(data.get("artifact", {}).get("name") == args.artifact.name, "artifact name mismatch")
    require(data.get("artifact", {}).get("sha256") == actual, "artifact hash mismatch")
    if data.get("platform") == "android":
        require(data["toolchain"].get("androidNdk") == "28.0.13004108", "missing pinned NDK provenance")
        require(data["toolchain"].get("gomobile") == "v0.0.0-20260908204917-8b95e45f8d3e", "missing pinned gomobile provenance")
        require('"17.' in data["toolchain"].get("java", ""), "missing actual Java 17 provenance")
    if "postprocessing" in data:
        require(data["postprocessing"].get("outputSha256") == actual, "postprocessing digest mismatch")
    print(json.dumps({"artifact": str(args.artifact), "sha256": actual, "projectCommit": data["projectCommit"]}, sort_keys=True))


if __name__ == "__main__":
    main()
