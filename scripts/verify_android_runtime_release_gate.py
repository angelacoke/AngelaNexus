#!/usr/bin/env python3
"""Fail closed unless every requested Android runtime has an approved record."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = {
    "xray": (ROOT / "docs/upstream/XRAY_ANDROID_RUNTIME_COMPLIANCE.json", "xray"),
    "singbox": (ROOT / "docs/upstream/SINGBOX_ANDROID_RUNTIME_COMPLIANCE.json", "sing-box"),
    "mihomo": (ROOT / "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json", "mihomo"),
}
REVIEW_FIELDS = ("licenseReview", "provenanceReview", "namingCompliance")
REQUIRED_CONTRACT = (
    "requiresDistributionApproval",
    "requiresLicenseReviewApproval",
    "requiresProvenanceApproval",
    "requiresNamingComplianceApproval",
)


def inspect_manifest(kernel: str) -> list[str]:
    path, expected_kernel = MANIFESTS[kernel]
    errors: list[str] = []
    if not path.is_file():
        return [f"{kernel}: compliance manifest missing ({path.relative_to(ROOT)})"]

    try:
        data: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{kernel}: compliance manifest unreadable: {exc}"]
    if not isinstance(data, dict):
        return [f"{kernel}: compliance manifest root must be a JSON object"]

    runtime = data.get("runtime")
    if not isinstance(runtime, dict) or runtime.get("kernel") != expected_kernel:
        errors.append(f"{kernel}: runtime.kernel must be {expected_kernel!r}")
    if not isinstance(runtime, dict) or not runtime.get("version"):
        errors.append(f"{kernel}: exact runtime version is missing")
    if not data.get("declaredLicense"):
        errors.append(f"{kernel}: declaredLicense is missing")
    if not isinstance(data.get("source"), dict):
        errors.append(f"{kernel}: exact source record is missing")

    if data.get("distributionStatus") != "approved":
        errors.append(f"{kernel}: distributionStatus is {data.get('distributionStatus')!r}, not 'approved'")

    for field in REVIEW_FIELDS:
        review = data.get(field)
        if not isinstance(review, dict) or review.get("status") != "approved":
            status = review.get("status") if isinstance(review, dict) else None
            errors.append(f"{kernel}: {field}.status is {status!r}, not 'approved'")

    policy = data.get("policy")
    if not isinstance(policy, dict) or policy.get("failClosed") is not True:
        errors.append(f"{kernel}: policy.failClosed must be true")
    contract = policy.get("runtimeContract") if isinstance(policy, dict) else None
    if not isinstance(contract, dict):
        errors.append(f"{kernel}: policy.runtimeContract is missing")
    else:
        for name in REQUIRED_CONTRACT:
            if contract.get(name) is not True:
                errors.append(f"{kernel}: runtime contract {name} must be true")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kernels",
        nargs="+",
        required=True,
        choices=tuple(MANIFESTS),
        help="runtime manifests that the release will embed",
    )
    args = parser.parse_args()

    errors: list[str] = []
    for kernel in dict.fromkeys(args.kernels):
        kernel_errors = inspect_manifest(kernel)
        if kernel_errors:
            errors.extend(kernel_errors)
            print(f"BLOCKED: {kernel}")
            for error in kernel_errors:
                print(f"  - {error}")
        else:
            print(f"APPROVED: {kernel}")

    if errors:
        print("Android runtime distribution gate: BLOCKED", file=sys.stderr)
        return 1
    print("Android runtime distribution gate: APPROVED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
