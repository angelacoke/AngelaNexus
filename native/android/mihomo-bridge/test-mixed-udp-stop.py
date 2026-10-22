#!/usr/bin/env python3
"""Fail-closed negatives on the exact host projection of the Android bridge."""
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
    stop_call = "err = errors.Join(err, socks.StopMixedUDP(ctx))"
    debt = "androidRuntime.mixedCleanupPending = err != nil"
    if original.count(gate) != 2 or any(original.count(s) != 1 for s in (start_gate, stop_call, debt)):
        raise SystemExit("mixed UDP stop layout changed; review negative controls")
    split = original.split(gate)
    test = "^TestAndroidBridgeMixedUDPStopFailureRetainsDebt$"
    controls = [
        ("missing-stop", original.replace(stop_call, "_ = socks.StopMixedUDP"),
         "^TestAndroidBridgeMixedUDPStopReleasesPortAndRestarts$",
         "mixed UDP port still owned after explicit stop"),
        ("forgotten-debt", original.replace(debt, "androidRuntime.mixedCleanupPending = false"), test,
         "successful components overwrote mixed UDP cleanup debt"),
        ("apply", split[0] + split[1] + gate + split[2], test,
         "fresh apply bypassed failed mixed UDP stop cleanup"),
        ("dns", split[0] + gate + split[1] + split[2], test,
         "fresh DNS update bypassed failed mixed UDP stop cleanup"),
        ("attachment", original.replace(start_gate, " {"), test,
         "attachment bypassed mixed UDP stop retry gate"),
    ]
    args.logs.mkdir(parents=True, exist_ok=True)

    def reject(name, selection, assertion):
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
                raise SystemExit(f"{name} negative {attempt}/3 failed unexpectedly:\n{result.stdout}")
            print(f"mixed UDP {name} negative {attempt}/3 intercepted missing stop ownership/gate", flush=True)

    try:
        for name, mutant, selection, assertion in controls:
            path.write_text(mutant)
            reject(name, selection, assertion)
    finally:
        path.write_text(original)
    if path.read_text() != expected:
        raise SystemExit("failed to restore exact production bridge projection")
    print("All fifteen actual-bridge mixed-UDP-stop negative controls passed; production source restored", flush=True)

    registry = source / "listener/socks/udp_lifecycle.go"
    registry_original = registry.read_text()
    packet_ack, write_ack = " && l.pending == 0", " && l.writes == 0"
    if any(registry_original.count(s) != 1 for s in (packet_ack, write_ack)):
        raise SystemExit("mixed UDP drain layout changed; review packet/write-back controls")
    try:
        for name, missing_ack, selection, assertion in [
            ("premature-packet-drain", packet_ack, "^TestAndroidBridgeMixedUDPPacketTimeoutRequiresRetry$",
             "held mixed UDP packet was not a stop timeout"),
            ("premature-writeback-drain", write_ack, "^TestAndroidBridgeMixedUDPWriteBackTimeoutRequiresRetry$",
             "admitted mixed UDP write-back was not a stop timeout"),
        ]:
            registry.write_text(registry_original.replace(missing_ack, ""))
            reject(name, selection, assertion)
    finally:
        registry.write_text(registry_original)
    if registry.read_text() != registry_original or path.read_text() != expected:
        raise SystemExit("failed to restore exact production UDP/bridge sources")
    print("All twenty-one actual-bridge mixed-UDP-stop/packet/writeback negative controls passed; production sources restored", flush=True)


if __name__ == "__main__":
    main()
