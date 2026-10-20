#!/usr/bin/env python3
"""Fail-closed verification of downloaded Mihomo Android native artifacts."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
REPOSITORY = "https://github.com/MetaCubeX/mihomo"
EXPECTED_PLATFORM = "android"
EXPECTED_BUILD_TAGS = {"with_gvisor", "cmfa"}
EXPECTED_BUILDMODE = "c-shared"
EXPECTED_PACKAGE = "./angelanexus_android"
EXPECTED_VERSION_LDFLAG = "github.com/metacubex/mihomo/constant.Version=v1.19.32"
EXPECTED_TOOLCHAIN = {"goos": "android", "androidNdk": "28.0.13004108", "cgoEnabled": True}
EXPECTED_GOARCH = {"arm64-v8a": "arm64", "armeabi-v7a": "arm", "x86_64": "amd64"}
HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


class VerificationError(Exception):
    pass


def fail(message: str) -> None:
    raise VerificationError(message)


def load_json(path: Path, label: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing {label}: {path}")
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"invalid {label} {path}: {exc}")


def require(mapping, key: str, label: str):
    if not isinstance(mapping, dict) or key not in mapping:
        fail(f"{label}: missing required field {key!r}")
    return mapping[key]


def require_object(mapping, key: str, label: str) -> dict:
    value = require(mapping, key, label)
    if not isinstance(value, dict):
        fail(f"{label}.{key} must be an object")
    return value


def require_string(mapping, key: str, label: str) -> str:
    value = require(mapping, key, label)
    if not isinstance(value, str):
        fail(f"{label}.{key} must be a string")
    return value


def require_hash(mapping, key: str, label: str) -> str:
    value = require_string(mapping, key, label)
    if not HEX64.fullmatch(value):
        fail(f"{label}.{key} must be a 64-character SHA-256 hex string")
    return value.lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        fail(f"cannot read artifact {path}: {exc}")
    return digest.hexdigest()


def manifest_values(repo: Path) -> tuple[str, str, dict[str, str]]:
    path = repo / "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"missing Kotlin Mihomo manifest {path}: {exc}")
    version = re.search(r'const val VERSION = "([^"]+)"', text)
    commit = re.search(r'const val SOURCE_COMMIT = "([0-9a-f]{40})"', text)
    if not version or not commit:
        fail(f"Kotlin Mihomo manifest is missing VERSION or SOURCE_COMMIT: {path}")
    hashes: dict[str, str] = {}
    specs = re.findall(r"MihomoNativeLibrarySpec\s*\(([^()]*)\)", text, re.S)
    if not specs:
        fail(f"Kotlin Mihomo manifest has no MihomoNativeLibrarySpec blocks: {path}")
    for spec in specs:
        abi_match = re.search(r'\babi\s*=\s*"([^"]+)"', spec)
        sha_match = re.search(r'\bsha256\s*=\s*"([^"]*)"', spec)
        if not abi_match:
            fail(f"Kotlin Mihomo manifest spec is missing abi: {path}")
        abi = abi_match.group(1)
        if abi in hashes:
            fail(f"Kotlin Mihomo manifest has duplicate ABI spec {abi}")
        if not sha_match or not HEX64.fullmatch(sha_match.group(1)):
            fail(f"Kotlin Mihomo manifest has no valid hash for ABI {abi}")
        hashes[abi] = sha_match.group(1).lower()
    for abi in ABIS:
        if abi not in hashes:
            fail(f"Kotlin Mihomo manifest has no complete spec for ABI {abi}")
    return version.group(1), commit.group(1), hashes


def verify(artifacts_root: Path, repo: Path) -> None:
    version, commit, manifest_hashes = manifest_values(repo)
    if version != "v1.19.32":
        fail(f"manifest version mismatch: expected v1.19.32, got {version}")
    compliance = load_json(repo / "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json", "upstream compliance JSON")
    runtime = require_object(compliance, "runtime", "compliance")
    if require(runtime, "kernel", "compliance.runtime") != "mihomo":
        fail("compliance runtime kernel is not mihomo")
    if require(runtime, "version", "compliance.runtime") != version.removeprefix("v"):
        fail("compliance version does not match Kotlin manifest")
    if require(runtime, "platform", "compliance.runtime") != EXPECTED_PLATFORM:
        fail("compliance platform is not android")
    abis = require(runtime, "abis", "compliance.runtime")
    if not isinstance(abis, list) or not all(isinstance(abi, str) for abi in abis):
        fail("compliance.runtime.abis must be a list of strings")
    if tuple(abis) != ABIS:
        fail("compliance ABI list does not exactly match required ABIs")
    source = require_object(compliance, "source", "compliance")
    if require(source, "repository", "compliance.source") != REPOSITORY:
        fail("compliance source repository mismatch")
    if require(source, "pinnedCommit", "compliance.source") != commit:
        fail("compliance pinned commit does not match Kotlin manifest")
    documented = require(compliance, "artifacts", "compliance")
    if not isinstance(documented, dict):
        fail("compliance artifacts must be an object")

    for abi in ABIS:
        root = artifacts_root / abi
        if not root.is_dir():
            fail(f"missing artifact directory for ABI {abi}: {root}")
        entries = list(root.iterdir())
        expected_names = {f"libclash-{abi}.so", f"mihomo-provenance-{abi}.json"}
        actual_names = {entry.name for entry in entries}
        if actual_names != expected_names or any(not entry.is_file() for entry in entries):
            fail(f"ABI {abi} must contain exactly {sorted(expected_names)}, found {sorted(actual_names)}")
        artifact = root / f"libclash-{abi}.so"
        provenance_path = root / f"mihomo-provenance-{abi}.json"
        actual_hash = sha256(artifact)
        expected_hash = manifest_hashes[abi]
        if actual_hash != expected_hash:
            fail(f"ABI {abi} artifact SHA-256 mismatch: computed {actual_hash}, manifest {expected_hash}")
        record = load_json(provenance_path, f"provenance for {abi}")
        if not isinstance(record, dict):
            fail(f"provenance {abi} must be an object")
        if require(record, "version", f"provenance {abi}") != 1:
            fail(f"provenance {abi} version must be 1")
        if require(record, "kernel", f"provenance {abi}") != "mihomo":
            fail(f"provenance {abi} kernel mismatch")
        if require(record, "kernelVersion", f"provenance {abi}") != version.removeprefix("v"):
            fail(f"provenance {abi} version mismatch")
        if require(record, "platform", f"provenance {abi}") != EXPECTED_PLATFORM:
            fail(f"provenance {abi} platform mismatch")
        if require(record, "abi", f"provenance {abi}") != abi:
            fail(f"provenance ABI mismatch: expected {abi}")
        psource = require_object(record, "source", f"provenance {abi}")
        if require(psource, "repository", f"provenance.source {abi}") != REPOSITORY:
            fail(f"provenance {abi} source repository mismatch")
        if require(psource, "commit", f"provenance.source {abi}") != commit:
            fail(f"provenance {abi} source commit mismatch")
        partifact = require_object(record, "artifact", f"provenance {abi}")
        if require(partifact, "name", f"provenance.artifact {abi}") != artifact.name:
            fail(f"provenance {abi} artifact name mismatch")
        if require_hash(partifact, "sha256", f"provenance.artifact {abi}") != actual_hash:
            fail(f"provenance {abi} artifact SHA-256 mismatch")
        doc = require(documented, abi, "compliance.artifacts")
        if require(doc, "file", f"compliance artifact {abi}") != "libclash.so":
            fail(f"compliance artifact {abi} filename mismatch")
        if require_hash(doc, "sha256", f"compliance artifact {abi}") != actual_hash:
            fail(f"compliance artifact {abi} SHA-256 mismatch")
        toolchain = require_object(record, "toolchain", f"provenance {abi}")
        for key, expected in EXPECTED_TOOLCHAIN.items():
            if require(toolchain, key, f"provenance.toolchain {abi}") != expected:
                fail(f"provenance {abi} toolchain {key} mismatch")
        expected_arch = EXPECTED_GOARCH[abi]
        if require(toolchain, "goarch", f"provenance.toolchain {abi}") != expected_arch:
            fail(f"provenance {abi} toolchain goarch mismatch")
        expected_goarm = "7" if expected_arch == "arm" else None
        if require(toolchain, "goarm", f"provenance.toolchain {abi}") != expected_goarm:
            fail(f"provenance {abi} toolchain goarm mismatch")
        build = require_object(record, "build", f"provenance {abi}")
        if require(build, "trimpath", f"provenance.build {abi}") is not True or require(build, "buildmode", f"provenance.build {abi}") != EXPECTED_BUILDMODE:
            fail(f"provenance {abi} build mode/trimpath mismatch")
        if require(build, "package", f"provenance.build {abi}") != EXPECTED_PACKAGE:
            fail(f"provenance {abi} library package mismatch")
        tags = require(build, "tags", f"provenance {abi}")
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            fail(f"provenance {abi} build tags must be a list of strings")
        if set(tags) != EXPECTED_BUILD_TAGS:
            fail(f"provenance {abi} build tags mismatch")
        if require(build, "versionLdflag", f"provenance.build {abi}") != EXPECTED_VERSION_LDFLAG:
            fail(f"provenance {abi} version ldflag mismatch")
        for name, relative in (("bridge", "native/android/mihomo-bridge/bridge.go"), ("lifecycle", "native/android/mihomo-bridge/lifecycle.go"), ("libraryEntry", "native/android/mihomo-bridge/library.go")):
            evidence = require_object(record, name, f"provenance {abi}")
            if require(evidence, "path", f"provenance.{name} {abi}") != relative:
                fail(f"provenance {abi} {name} path mismatch")
            expected_digest = require_hash(evidence, "sha256", f"provenance.{name} {abi}")
            actual_digest = sha256(repo / relative)
            if actual_digest != expected_digest:
                fail(f"provenance {abi} {name} source digest mismatch: checkout {actual_digest}, provenance {expected_digest}")
    print(f"Mihomo native artifacts verified: {', '.join(ABIS)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-root", required=True, type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        verify(args.artifacts_root.resolve(), args.repo_root.resolve())
    except VerificationError as exc:
        print(f"Mihomo artifact verification FAILED: {exc}", file=sys.stderr)
        return 1
    except (AttributeError, TypeError, ValueError) as exc:
        print(f"Mihomo artifact verification FAILED: invalid data structure: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
