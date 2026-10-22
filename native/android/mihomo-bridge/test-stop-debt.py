#!/usr/bin/env python3
"""Prove each resource-stop retry gate matters on the actual host bridge.

The caller prepares the pinned source and copies the production bridge with only
its Android build constraint removed. Mutations affect that temporary host copy
only, are always restored, and must fail at their specific assertion (not build,
race, panic or timeout failures). This is not Android TUN/JNI acceptance.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--logs", required=True, type=Path)
    args = parser.parse_args()
    source = args.source.resolve()
    bridge = source / "angelanexus_android/bridge.go"
    production = Path(__file__).with_name("bridge.go").read_text()
    original = bridge.read_text()
    expected = production.split("\n", 2)[2]
    if original != expected:
        raise SystemExit("host bridge differs from exact production build-constraint projection")
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != "88dcbf7f1614a67c3b36b848ee3592dfa92ada36":
        raise SystemExit("unexpected Mihomo source commit")
    args.logs.mkdir(parents=True, exist_ok=True)
    gate = "\tif androidRuntime.resourceCleanupPending {\n\t\treturn errAndroidResourceCleanupPending\n\t}\n"
    if original.count(gate) != 2:
        raise SystemExit("configuration gate layout changed; review negative controls")
    start_gate = " || androidRuntime.resourceCleanupPending || androidRuntime.mixedCleanupPending {"
    if original.count(start_gate) != 1:
        raise SystemExit("attachment gate layout changed; review negative controls")
    split = original.split(gate)
    controls = [
        ("apply", split[0] + split[1] + gate + split[2],
         "^TestAndroidBridgeResourceStopDebtRejectsFreshConfiguration$/^listener$",
         "fresh apply bypassed failed explicit-stop resource cleanup"),
        ("dns", split[0] + gate + split[1] + split[2],
         "^TestAndroidBridgeResourceStopDebtRejectsFreshConfiguration$/^listener$",
         "fresh DNS update bypassed failed explicit-stop resource cleanup"),
        ("attachment", original.replace(start_gate, " || androidRuntime.mixedCleanupPending {"),
         "^TestAndroidBridgeResourceStopDebtBlocksAttachmentBeforeCleanup$",
         "attachment bypassed explicit stop retry and performed cleanup/construction"),
    ]
    try:
        for name, mutant, selection, assertion in controls:
            bridge.write_text(mutant)
            for attempt in range(1, 4):
                result = subprocess.run(
                    ["go", "test", "-race", "-tags=with_gvisor,cmfa", "-run", selection,
                     "-count=1", "-timeout=30s", "-v", "./angelanexus_android"],
                    cwd=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    timeout=120, env=dict(os.environ),
                )
                (args.logs / f"{name}-old-{attempt}.log").write_text(result.stdout)
                if (result.returncode == 0 or assertion not in result.stdout
                        or "--- FAIL: TestAndroidBridgeResourceStopDebt" not in result.stdout
                        or re.search(r"DATA RACE|panic:|test timed out|build failed|no tests to run", result.stdout, re.I)):
                    raise SystemExit(f"{name} negative {attempt}/3 did not fail at its expected assertion:\n{result.stdout}")
                print(f"{name} negative {attempt}/3 intercepted missing resource-stop retry gate", flush=True)
    finally:
        bridge.write_text(original)
    if bridge.read_text() != expected:
        raise SystemExit("failed to restore exact host bridge")
    print("All nine actual-bridge resource-stop negative controls passed; production source restored", flush=True)


if __name__ == "__main__":
    main()
