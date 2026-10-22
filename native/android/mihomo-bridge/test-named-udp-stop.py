#!/usr/bin/env python3
"""Fail-closed named UDP mutations on the exact production host projection."""
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
    bridge = source / "angelanexus_android/bridge.go"
    expected = Path(__file__).with_name("bridge.go").read_text().split("\n", 2)[2]
    if bridge.read_text() != expected:
        raise SystemExit("host source differs from exact production bridge projection")
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != "88dcbf7f1614a67c3b36b848ee3592dfa92ada36":
        raise SystemExit("unexpected Mihomo source commit")
    constants = {}
    for node in ast.parse(Path(__file__).with_name("prepare-upstream.py").read_text()).body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    constants[target.id] = node.value.value
    named = source / "listener/inbound/mixed.go"
    udp = source / "listener/socks/udp_lifecycle.go"
    registry = source / "listener/inbound/mixed_lifecycle.go"
    originals = {p: p.read_text() for p in (named, udp, registry)}
    for path, key in [(named, "PATCHED_NAMED_MIXED_SHA256"), (udp, "PATCHED_MIXED_UDP_REGISTRY_SHA256"),
                      (registry, "PATCHED_NAMED_MIXED_REGISTRY_SHA256")]:
        if hashlib.sha256(path.read_bytes()).hexdigest() != constants.get(key):
            raise SystemExit(f"source differs from reviewed production digest: {path}")
    # Exact constructor spelling and UDP wait are reviewed alongside the adapter.
    constructor = "socks.NewOwnedUDPWithConfig("
    if originals[named].count(constructor) != 1:
        raise SystemExit("named owned UDP constructor layout changed; review controls")
    controls = [
        ("legacy-unowned-constructor", named, originals[named].replace(constructor, "socks.NewUDPWithConfig("),
         "PacketTimeoutRequiresRetry", "held named UDP packet was not a stop timeout"),
        ("default-registry-capture", named, originals[named].replace(constructor, "socks.NewMixedUDPWithConfig("),
         "DefaultRegistryIsolation", "default UDP registry captured named generation"),
    ]
    for name, token, test, assertion in [
        ("premature-packet-drain", " && l.pending == 0", "PacketTimeoutRequiresRetry", "held named UDP packet was not a stop timeout"),
        ("premature-writeback-drain", " && l.writes == 0", "WriteBackTimeoutRequiresRetry", "admitted named UDP write-back was not a stop timeout"),
        ("premature-handler-drain", " && l.readerDone", "HandlerTimeoutRequiresRetry", "named UDP handler exit was not a stop timeout"),
    ]:
        if originals[udp].count(token) != 1:
            raise SystemExit(f"UDP drain layout changed: {token}; review controls")
        controls.append((name, udp, originals[udp].replace(token, ""), test, assertion))
    retained = "if !done[m] {"
    if originals[registry].count(retained) != 1:
        raise SystemExit("named generation retention layout changed; review controls")
    controls.append(("forgotten-timed-out-generation", registry, originals[registry].replace(retained, "if true {"),
                     "PacketTimeoutRequiresRetry", "named UDP retry forgot still-held generation"))
    args.logs.mkdir(parents=True, exist_ok=True)
    try:
        for name, path, mutant, test, assertion in controls:
            path.write_text(mutant)
            try:
                for attempt in range(1, 4):
                    result = subprocess.run(
                        ["go", "test", "-race", "-tags=with_gvisor,cmfa", "-run",
                         f"^TestAndroidBridgeNamedInboundUDP{test}$", "-count=1", "-timeout=30s", "-v", "./angelanexus_android"],
                        cwd=source, env=dict(os.environ), text=True, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, timeout=150,
                    )
                    (args.logs / f"{name}-old-{attempt}.log").write_text(result.stdout)
                    if (result.returncode == 0 or assertion not in result.stdout
                            or "--- FAIL: TestAndroidBridgeNamedInboundUDP" not in result.stdout
                            or re.search(r"DATA RACE|panic:|test timed out|build failed|no tests to run", result.stdout, re.I)):
                        raise SystemExit(f"{name} negative {attempt}/3 failed unexpectedly:\n{result.stdout}")
                    print(f"named UDP {name} negative {attempt}/3 intercepted missing ownership/join", flush=True)
            finally:
                path.write_text(originals[path])
    finally:
        for path, text in originals.items():
            path.write_text(text)
    if bridge.read_text() != expected or any(p.read_text() != text for p, text in originals.items()):
        raise SystemExit("failed to restore exact production sources")
    print("All eighteen actual-bridge named UDP ownership/packet/writeback/handler controls passed; production sources restored", flush=True)


if __name__ == "__main__":
    main()
