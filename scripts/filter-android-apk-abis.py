#!/usr/bin/env python3
"""Filter native ABI directories from an APK before it is re-signed."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Iterable

SUPPORTED_ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
REQUIRED_NATIVE_LIBRARIES = ("libclash.so", "libmihomo-jni.so")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_abis(value: str) -> tuple[str, ...]:
    abis = tuple(part.strip() for part in value.split(",") if part.strip())
    if not abis:
        raise ValueError("At least one ABI must be selected.")
    if len(set(abis)) != len(abis):
        raise ValueError("ABI list contains duplicates.")
    unsupported = sorted(set(abis) - set(SUPPORTED_ABIS))
    if unsupported:
        raise ValueError(f"Unsupported ABI(s): {', '.join(unsupported)}")
    return abis


def is_signature_metadata(name: str) -> bool:
    upper = name.upper()
    prefix = "META-INF/"
    if not upper.startswith(prefix):
        return False
    leaf = upper[len(prefix) :]
    if "/" in leaf:
        return False
    return leaf == "MANIFEST.MF" or leaf.endswith((".SF", ".RSA", ".DSA", ".EC"))


def abi_for_entry(name: str) -> str | None:
    parts = name.split("/")
    if len(parts) >= 3 and parts[0] == "lib":
        abi = parts[1]
        if abi in SUPPORTED_ABIS:
            return abi
        if parts[-1].lower().endswith(".so"):
            raise ValueError(f"Unexpected native ABI directory in APK: {name}")
    return None


def unique_names(archive: zipfile.ZipFile) -> None:
    names = archive.namelist()
    if len(names) != len(set(names)):
        raise ValueError("APK contains duplicate ZIP entry names; refusing to rewrite it.")


def inspect_source(path: Path) -> tuple[dict[str, dict[str, str]], set[str]]:
    native_hashes: dict[str, dict[str, str]] = {abi: {} for abi in SUPPORTED_ABIS}
    present_abis: set[str] = set()
    with zipfile.ZipFile(path, "r") as archive:
        unique_names(archive)
        bad_entry = archive.testzip()
        if bad_entry:
            raise ValueError(f"Corrupt ZIP entry in source APK: {bad_entry}")
        for info in archive.infolist():
            if info.is_dir() or is_signature_metadata(info.filename):
                continue
            abi = abi_for_entry(info.filename)
            if abi is None:
                continue
            present_abis.add(abi)
            if info.filename.lower().endswith(".so"):
                native_hashes[abi][info.filename.rsplit("/", 1)[-1]] = sha256(archive.read(info))

    if present_abis != set(SUPPORTED_ABIS):
        raise ValueError(
            "Expected the universal baseline APK to contain exactly the supported ABI set; "
            f"found {', '.join(sorted(present_abis)) or '(none)'}"
        )
    for abi in SUPPORTED_ABIS:
        missing = sorted(set(REQUIRED_NATIVE_LIBRARIES) - set(native_hashes[abi]))
        if missing:
            raise ValueError(f"{abi} is missing required native library/libraries: {', '.join(missing)}")
    return native_hashes, present_abis


def write_filtered(source: Path, output: Path, abis: tuple[str, ...], report_path: Path | None) -> None:
    if source.resolve() == output.resolve():
        raise ValueError("Output APK must not overwrite the source APK.")
    native_hashes, present_abis = inspect_source(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    selected = set(abis)
    with zipfile.ZipFile(source, "r") as original, zipfile.ZipFile(
        output, "w", allowZip64=True
    ) as filtered:
        unique_names(original)
        filtered.comment = original.comment
        for info in original.infolist():
            if is_signature_metadata(info.filename):
                continue
            abi = abi_for_entry(info.filename)
            if abi is not None and abi not in selected:
                continue
            filtered.writestr(info, original.read(info))

    if report_path:
        report = {
            "sourceApk": source.name,
            "sourceBytes": source.stat().st_size,
            "filteredUnsignedApk": output.name,
            "filteredUnsignedBytes": output.stat().st_size,
            "sourceAbis": sorted(present_abis),
            "retainedAbis": list(abis),
            "removedAbis": sorted(present_abis - selected),
            "nativeLibrariesSha256": {abi: native_hashes[abi] for abi in abis},
            "signatureMetadataRemovedBeforeResigning": True,
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def payload_hashes(path: Path) -> tuple[dict[str, str], set[str], dict[str, set[str]]]:
    hashes: dict[str, str] = {}
    present_abis: set[str] = set()
    native_names: dict[str, set[str]] = {abi: set() for abi in SUPPORTED_ABIS}
    with zipfile.ZipFile(path, "r") as archive:
        unique_names(archive)
        bad_entry = archive.testzip()
        if bad_entry:
            raise ValueError(f"Corrupt ZIP entry in {path.name}: {bad_entry}")
        for info in archive.infolist():
            name = info.filename
            if info.is_dir() or is_signature_metadata(name):
                continue
            abi = abi_for_entry(name)
            if abi is not None:
                present_abis.add(abi)
                if name.lower().endswith(".so"):
                    native_names[abi].add(name.rsplit("/", 1)[-1])
            hashes[name] = sha256(archive.read(info))
    return hashes, present_abis, native_names


def verify_pair(original: Path, filtered: Path, abis: tuple[str, ...]) -> None:
    native_hashes, _source_abis = inspect_source(original)
    selected = set(abis)
    original_hashes, _original_abis, _original_native = payload_hashes(original)
    filtered_hashes, filtered_abis, filtered_native = payload_hashes(filtered)
    expected = {
        name: digest
        for name, digest in original_hashes.items()
        if abi_for_entry(name) is None or abi_for_entry(name) in selected
    }
    if expected != filtered_hashes:
        missing = sorted(set(expected) - set(filtered_hashes))
        extra = sorted(set(filtered_hashes) - set(expected))
        changed = sorted(
            name
            for name in set(expected) & set(filtered_hashes)
            if expected[name] != filtered_hashes[name]
        )
        raise ValueError(
            "Filtered APK payload differs from the source beyond removed ABIs/signatures: "
            f"missing={missing[:10]}, extra={extra[:10]}, changed={changed[:10]}"
        )
    if filtered_abis != selected:
        raise ValueError(
            f"Filtered APK ABI directories are {sorted(filtered_abis)}, expected {sorted(selected)}"
        )
    for abi in abis:
        missing = sorted(set(REQUIRED_NATIVE_LIBRARIES) - filtered_native[abi])
        if missing:
            raise ValueError(f"Filtered APK {abi} is missing required library/libraries: {', '.join(missing)}")
        for library in REQUIRED_NATIVE_LIBRARIES:
            source_digest = native_hashes[abi][library]
            entry_name = f"lib/{abi}/{library}"
            if filtered_hashes.get(entry_name) != source_digest:
                raise ValueError(f"Native library changed during filtering: {entry_name}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    filter_parser = subparsers.add_parser("filter", help="remove unselected ABI directories")
    filter_parser.add_argument("--apk", required=True, type=Path)
    filter_parser.add_argument("--output", required=True, type=Path)
    filter_parser.add_argument("--abis", required=True)
    filter_parser.add_argument("--report", type=Path)

    verify_parser = subparsers.add_parser("verify", help="compare retained payload with source APK")
    verify_parser.add_argument("--original", required=True, type=Path)
    verify_parser.add_argument("--filtered", required=True, type=Path)
    verify_parser.add_argument("--abis", required=True)
    return parser


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        abis = parse_abis(args.abis)
        if args.command == "filter":
            write_filtered(args.apk, args.output, abis, args.report)
            print(f"Filtered APK to ABI set: {','.join(abis)}")
        else:
            verify_pair(args.original, args.filtered, abis)
            print(f"Verified retained APK payload for ABI set: {','.join(abis)}")
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
