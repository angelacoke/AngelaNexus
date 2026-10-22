#!/usr/bin/env python3
"""Fail-closed negative controls on the exact host projection of Android bridge."""
from pathlib import Path
import argparse
import os
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--logs", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    path = source / "angelanexus_android/bridge.go"
    original = path.read_text()
    expected = Path(__file__).with_name("bridge.go").read_text().split("\n", 2)[2]
    if original != expected:
        raise SystemExit("host source differs from exact production bridge projection")
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != "88dcbf7f1614a67c3b36b848ee3592dfa92ada36":
        raise SystemExit("unexpected Mihomo source commit")
    gate = "\tif androidRuntime.mixedCleanupPending {\n\t\treturn errAndroidMixedCleanupPending\n\t}\n"
    start_gate = " || androidRuntime.mixedCleanupPending {"
    stop_call = "err := mixed.StopListeners(ctx)"
    debt = "androidRuntime.mixedCleanupPending = err != nil"
    if original.count(gate) != 2 or any(original.count(s) != 1 for s in (start_gate, stop_call, debt)):
        raise SystemExit("mixed stop layout changed; review negative controls")
    split = original.split(gate)
    test = "^TestAndroidBridgeMixedStopFailureRetainsIndependentDebt$"
    controls = [
        ("missing-stop", original.replace(stop_call, "_ = mixed.StopListeners; err := ctx.Err()"),
         "^TestAndroidBridgeMixedStopReleasesListenerAndRestartsSamePort$",
         "mixed pre-first-byte peer did not observe EOF after stop"),
        ("forgotten-debt", original.replace(debt, "androidRuntime.mixedCleanupPending = false"), test,
         "successful components overwrote independent mixed cleanup debt"),
        ("apply", split[0] + split[1] + gate + split[2], test,
         "fresh apply bypassed failed mixed stop cleanup"),
        ("dns", split[0] + gate + split[1] + split[2], test,
         "fresh DNS update bypassed failed mixed stop cleanup"),
        ("attachment", original.replace(start_gate, " {"), test,
         "attachment bypassed mixed stop retry gate"),
    ]
    args.logs.mkdir(parents=True, exist_ok=True)
    try:
        for name, mutant, selection, assertion in controls:
            path.write_text(mutant)
            for attempt in range(1, 4):
                result = subprocess.run(
                    ["go", "test", "-race", "-tags=with_gvisor,cmfa", "-run", selection,
                     "-count=1", "-timeout=30s", "-v", "./angelanexus_android"],
                    cwd=source, env=dict(os.environ), text=True, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, timeout=120,
                )
                (args.logs / f"{name}-old-{attempt}.log").write_text(result.stdout)
                if (result.returncode == 0 or assertion not in result.stdout
                        or "--- FAIL: TestAndroidBridgeMixed" not in result.stdout
                        or re.search(r"DATA RACE|panic:|test timed out|build failed|no tests to run", result.stdout, re.I)):
                    raise SystemExit(f"{name} negative {attempt}/3 failed for an unexpected reason:\n{result.stdout}")
                print(f"mixed {name} negative {attempt}/3 intercepted missing stop ownership/gate", flush=True)
    finally:
        path.write_text(original)
    if path.read_text() != expected:
        raise SystemExit("failed to restore exact production bridge projection")
    print("All fifteen actual-bridge mixed-stop negative controls passed; production source restored", flush=True)


if __name__ == "__main__":
    main()
