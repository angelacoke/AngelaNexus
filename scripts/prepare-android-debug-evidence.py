#!/usr/bin/env python3
"""Download one successful android-build run by immutable ID for debug-only replay."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+", args.run_id) or not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise SystemExit("immutable run ID and full source SHA required")
    repo = os.environ["GITHUB_REPOSITORY"]
    run = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/actions/runs/{args.run_id}"], text=True))
    expected = {"head_sha": args.source_commit, "status": "completed", "conclusion": "success", "path": ".github/workflows/android-build.yml"}
    for key, value in expected.items():
        if run.get(key) != value:
            raise SystemExit(f"source run {key} mismatch")
    if run.get("repository", {}).get("full_name") != repo or run.get("head_repository", {}).get("full_name") != repo:
        raise SystemExit("source repository mismatch")
    # checkout PR merge SHA is different from run.head_sha; the AAR provenance
    # binds the actual source checkout. Require it explicitly below, never guess.
    if run.get("event") != "push":
        raise SystemExit("replay requires a direct source checkout, not a PR merge checkout")
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise SystemExit("output directory must be empty")
    subprocess.run(["gh", "run", "download", args.run_id, "--repo", repo,
                    "--name", "angelanexus-android-native-kernel-aars", "--dir", str(args.output)], check=True)
    expected_files = {"libXray.aar", "libxray-provenance.json", "libbox.aar", "libbox-legacy.aar"}
    if {p.name for p in args.output.iterdir()} != expected_files:
        raise SystemExit("unexpected source artifact file set")
    provenance = json.loads((args.output / "libxray-provenance.json").read_text())
    if provenance.get("projectCommit") != args.source_commit:
        raise SystemExit("source AAR checkout mismatch")
    # Keep metadata alongside the final report, outside the app dependency dir.
    (args.output.parent / "source-run.json").write_text(json.dumps(run, indent=2) + "\n")
    print(f"Downloaded exact Android source run {args.run_id} at {args.source_commit}")


if __name__ == "__main__":
    main()
