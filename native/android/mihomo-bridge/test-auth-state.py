#!/usr/bin/env python3
"""Fail closed on real-bridge old admission semantics and auth/filter races."""
import argparse
import ast
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--logs", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    project = Path(__file__).parent
    contract = {}
    for node in ast.parse((project / "prepare-upstream.py").read_text()).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("AUTH_STATE_INPUTS", "AUTH_STATE_OUTPUTS", "AUTH_STATE_PATCH_SHA256"):
            contract[node.targets[0].id] = ast.literal_eval(node.value)
    inputs, outputs = contract["AUTH_STATE_INPUTS"], contract["AUTH_STATE_OUTPUTS"]
    patch = project / "auth-state.patch"
    if digest(patch.read_bytes()) != contract["AUTH_STATE_PATCH_SHA256"]:
        raise SystemExit("unreviewed auth patch")
    if subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() != "88dcbf7f1614a67c3b36b848ee3592dfa92ada36":
        raise SystemExit("unexpected pinned upstream commit")
    expected_bridge = (project / "bridge.go").read_text().split("\n", 2)[2]
    bridge = source / "angelanexus_android/bridge.go"
    if bridge.read_text() != expected_bridge:
        raise SystemExit("host bridge must be the exact production projection")
    originals = {rel: (source / rel).read_bytes() for rel in outputs}
    if any(digest(data) != outputs[rel] for rel, data in originals.items()):
        raise SystemExit("production auth source hash mismatch")
    args.logs.mkdir(parents=True, exist_ok=True)
    sections = [p for p in re.split(r"(?m)(?=^--- )", patch.read_text()) if p]
    if len(sections) != len(inputs):
        raise SystemExit("unexpected patch section count")
    legacy = {}
    with tempfile.TemporaryDirectory(prefix="auth-state-negative-") as tmp:
        for i, (rel, expected) in enumerate(inputs.items()):
            section = sections[i]
            if not section.startswith(f"--- {rel}\n+++ {rel}\n"):
                raise SystemExit("unexpected auth patch path")
            sp, output = Path(tmp) / f"{i}.patch", Path(tmp) / f"{i}.go"
            sp.write_text(section)
            subprocess.run(["patch", "--batch", "--silent", "--reverse", "--output", str(output), str(source / rel), str(sp)], check=True, capture_output=True)
            content = output.read_bytes()
            if digest(content) != expected:
                raise SystemExit(f"legacy input hash mismatch: {rel}")
            legacy[rel] = content
    tags = "-tags=with_gvisor,cmfa"
    targets = (
        ("pinned-admission", "TestAndroidBridgeAuthStatePinnedAcrossApplySameListener", False),
        ("concurrent-apply", "TestAndroidBridgeAuthStateConcurrentApplyAndPeers", True),
    )
    try:
        for rel, content in legacy.items():
            if content:
                (source / rel).write_bytes(content)
            else:
                (source / rel).unlink()
        for name, test, race in targets:
            listed = subprocess.run(["go", "test", tags, "-list", f"^{test}$", "./angelanexus_android"], cwd=source, text=True, capture_output=True, timeout=120)
            if listed.returncode or test not in listed.stdout.splitlines():
                raise SystemExit(f"negative selection is empty or fails to build: {test}\n{listed.stdout}\n{listed.stderr}")
            for n in (1, 2, 3):
                cmd = ["go", "test", tags, "-run", f"^{test}$", "-count=1", "-timeout=45s", "-v", "./angelanexus_android"]
                if race:
                    cmd.insert(2, "-race")
                result = subprocess.run(cmd, cwd=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=150)
                text = result.stdout
                (args.logs / f"{name}-old-{n}.log").write_text(text)
                if result.returncode == 0 or f"--- FAIL: {test}" not in text or re.search(r"panic:|test timed out|build failed|no tests to run", text, re.I):
                    raise SystemExit(f"auth {name} negative {n}/3 failed unexpectedly:\n{text}")
                if race:
                    if "DATA RACE" not in text or not re.search(r"Set(SkipAuthPrefixes|AllowedIPs|DisAllowedIPs|Authenticator)", text) or not re.search(r"SkipAuth|IsRemoteAddrDisAllowed|authStore\).*Authenticator", text):
                        raise SystemExit(f"old implementation did not reproduce the targeted auth/filter race:\n{text}")
                elif "accepted A peer used credentials from later apply" not in text or "DATA RACE" in text:
                    raise SystemExit(f"old implementation failed for an unrelated semantic reason:\n{text}")
                print(f"auth {name} negative {n}/3 intercepted cross-generation admission/race", flush=True)
    finally:
        for rel, data in originals.items():
            (source / rel).write_bytes(data)
    if bridge.read_text() != expected_bridge or any((source / rel).read_bytes() != data for rel, data in originals.items()):
        raise SystemExit("failed to restore production source")
    print("All six actual-bridge auth-state old-semantics/race controls passed; production sources restored", flush=True)


if __name__ == "__main__":
    main()
