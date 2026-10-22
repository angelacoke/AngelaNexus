#!/usr/bin/env python3
"""Mutation controls on the exact production host projection, not a fake stop."""
import argparse
import ast
import hashlib
import os
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--logs", type=Path, required=True)
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
    gate = "\tif androidRuntime.namedCleanupPending {\n\t\treturn errAndroidNamedCleanupPending\n\t}\n"
    start_gate = " || androidRuntime.namedCleanupPending"
    stop_call = "err := namedinbound.StopNamedMixed(ctx)"
    debt = "androidRuntime.namedCleanupPending = err != nil"
    if original.count(gate) != 2 or any(original.count(s) != 1 for s in (start_gate, stop_call, debt)):
        raise SystemExit("named inbound stop layout changed; review negative controls")
    helper = source / "listener/inbound/mixed_lifecycle.go"
    helper_original = helper.read_text()
    wanted = {}
    for node in ast.parse(Path(__file__).with_name("prepare-upstream.py").read_text()).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    wanted[target.id] = node.value.value
    if hashlib.sha256(helper.read_bytes()).hexdigest() != wanted.get("PATCHED_NAMED_MIXED_REGISTRY_SHA256"):
        raise SystemExit("named registry source differs from reviewed production digest")
    wait = "if err := m.WaitClosed(ctx); err != nil {"
    if helper_original.count(wait) != 1:
        raise SystemExit("named handler wait layout changed; review negative control")
    split = original.split(gate)
    test = "^TestAndroidBridgeNamedInboundFailureRetainsIndependentDebt$"
    controls = [
        ("missing-stop", original.replace(stop_call, "_ = namedinbound.StopNamedMixed; err := ctx.Err()"),
         "^TestAndroidBridgeNamedInboundStopRebuildSameConfig$", "named inbound peer survived explicit stop"),
        ("forgotten-debt", original.replace(debt, "androidRuntime.namedCleanupPending = false"), test,
         "successful components overwrote independent named cleanup debt"),
        ("apply", split[0] + split[1] + gate + split[2], test, "fresh apply bypassed named cleanup debt"),
        ("dns", split[0] + gate + split[1] + split[2], test, "fresh DNS bypassed named cleanup debt"),
        ("attachment", original.replace(start_gate, ""), test, "attachment bypassed named cleanup debt"),
    ]
    args.logs.mkdir(parents=True, exist_ok=True)
    try:
        controls = [(name, path, mutant, selection, assertion) for name, mutant, selection, assertion in controls]
        controls.append(("premature-handler-drain", helper,
                         helper_original.replace(wait, "if err := ctx.Err(); err != nil {"),
                         "^TestAndroidBridgeNamedInboundWaitsForHandlerAndRetries$",
                         "named stop did not await blocked handler"))
        for name, target, mutant, selection, assertion in controls:
            path.write_text(original)
            helper.write_text(helper_original)
            target.write_text(mutant)
            for attempt in range(1, 4):
                result = subprocess.run(
                    ["go", "test", "-race", "-tags=with_gvisor,cmfa", "-run", selection,
                     "-count=1", "-timeout=30s", "-v", "./angelanexus_android"],
                    cwd=source, env=dict(os.environ), text=True, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, timeout=120,
                )
                (args.logs / f"{name}-old-{attempt}.log").write_text(result.stdout)
                if (result.returncode == 0 or assertion not in result.stdout
                        or "--- FAIL: TestAndroidBridgeNamedInbound" not in result.stdout
                        or re.search(r"DATA RACE|panic:|test timed out|build failed|no tests to run", result.stdout, re.I)):
                    raise SystemExit(f"{name} negative {attempt}/3 failed unexpectedly:\n{result.stdout}")
                print(f"named inbound {name} negative {attempt}/3 intercepted missing ownership/gate", flush=True)
    finally:
        path.write_text(original)
        helper.write_text(helper_original)
    if path.read_text() != expected or helper.read_text() != helper_original:
        raise SystemExit("failed to restore exact production bridge projection")
    print("All eighteen actual-bridge named inbound controls passed; production sources restored", flush=True)


if __name__ == "__main__":
    main()
