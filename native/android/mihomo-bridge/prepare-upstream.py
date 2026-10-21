#!/usr/bin/env python3
"""Apply reviewed owned-FD, statistics and late-result adapters to one checkout.

This deliberately refuses unknown source trees.  It is the reproducible boundary
between the Android bridge and sing-tun: only the pinned mihomo commit and
sing-tun v0.4.27 implementation are accepted.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

COMMIT = "88dcbf7f1614a67c3b36b848ee3592dfa92ada36"
SING_TUN_VERSION = "v0.4.27"
# Hashes are of the pristine pinned checkout/module files, before this adapter.
EXPECTED = {
    "go.mod": "72b10f80ec33e2e06dee425a75e499d5818039c99d4e25f745d0bca349c90af5",
    "go.sum": "8fa2b10fe8589a4a1118fd6819f59231f74a27e71c8154de9c3903a69c3735aa",
    "listener/sing_tun/server.go": "8b0d766e346aa5a36ec40dc66c1fe7cd3466ead48a687cfb4a262342ca9a3335",
    "listener/sing_tun/server_notwindows.go": "b455a1c900fa94bde40c09b01183c28414b1bf45810ff79ba5eb58f7c34ee66c",
    "component/nat/table.go": "e683db1cc9a41980b0c860d506663ed3d412260df5abc70f903106e1ebf82c54",
    "tunnel/connection.go": "1e48fbdff3551c8d0dcbe5265088c3b56db0b66eb9c7512af5aaa31e8e65af1b",
    "tunnel/statistic/manager.go": "508daa254d05b6414e899e4eb154cb3b83572d6223e5662da9463728cb588886",
    "tunnel/statistic/tracker.go": "80e8cc0df115c35a62baea5aec4c3ad4a28c1cf9c47c52a78e76523520c83a6f",
    "component/sniffer/quic_sniffer.go": "1b7cb7990ae0667885d2977d002c72422c5f36f61b5dca9616b71ece97e586a5",
    "tunnel/tunnel.go": "bd0818dddd04779aad3f078819b3ca050bd8bdce29ba57e5a377770539278596",
}
# sing-tun is supplied by Go's module cache; verify the implementation that
# accepts an already-open fd, not merely the version string in go.mod.
SING_TUN_TUN_LINUX_SHA256 = "34d3c504a859006bf2981709d86e104c9a2b7c9542ef5895201ce2a723ecac54"
PATCHED_SERVER_SHA256 = "1a77f3a7416b8074bc5e91c4944079c059fe766991bccfaa921780ad0068b8e1"
PATCHED_STATISTICS_SHA256 = "316e372b7de3735a9a44c8f2357092ee1023fb21c6bbb899ea6a5228cc1dbb09"
STATISTICS_PATCH_SHA256 = "293330f8b4ba6ed0fb318ea43f5bb759b0946fa98f44c563131135441d4c124b"
LATE_CONNECTIONS_PATCH_SHA256 = "18f47f54fc548322643be8dac9deca3fc89c8e1090cf622482c5a872aae51481"
PATCHED_LATE_MANAGER_SHA256 = "95821b706b1e43a17fe427592a2d5d41f5093d8a7e8c7fc76e4dd33300e51716"
PATCHED_NAT_TABLE_SHA256 = "14c048a266086e2dec951d8874e1fa67d31085edf86c4b8aae1625caeef29e90"
PATCHED_CONNECTION_SHA256 = "7f49df0990618e61ae9c4bd6763a80a7da0627ee1a0ec6fa44c68f7301f1c87a"
PATCHED_TRACKER_SHA256 = "790b996d9e8144ecc453c6624b11664f2956d068e8ccb284f046be9afc09c99b"
PATCHED_QUIC_SNIFFER_SHA256 = "51a3e923cf1d58a5fe05c43793bb53f5edfb588e61cafd6d7f82d42e4dd11a9b"
PATCHED_TUNNEL_SHA256 = "42c64d637703b7ba76ed07b47a3fb3808b02b62e8b60654394b7a2c1a940869a"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"prepare-upstream: {message}")


def verify_source(root: Path) -> None:
    if not (root / ".git").exists():
        fail(f"not a git checkout: {root}")
    try:
        actual = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
        dirty = subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=all"], text=True
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"cannot inspect git checkout: {exc}")
    if actual != COMMIT:
        fail(f"unexpected mihomo commit {actual!r}; expected {COMMIT}")
    patched_server = root / "listener/sing_tun/server.go"
    patched_hash = sha256(patched_server) if patched_server.is_file() else None
    nat_table = root / "component/nat/table.go"
    connection = root / "tunnel/connection.go"
    nat_table_hash = sha256(nat_table) if nat_table.is_file() else None
    connection_hash = sha256(connection) if connection.is_file() else None
    statistics = root / "tunnel/statistic/manager.go"
    statistics_hash = sha256(statistics) if statistics.is_file() else None
    tracker = root / "tunnel/statistic/tracker.go"
    tracker_hash = sha256(tracker) if tracker.is_file() else None
    quic_sniffer = root / "component/sniffer/quic_sniffer.go"
    quic_sniffer_hash = sha256(quic_sniffer) if quic_sniffer.is_file() else None
    tunnel = root / "tunnel/tunnel.go"
    tunnel_hash = sha256(tunnel) if tunnel.is_file() else None
    # Existing adapter output is allowed only when it is exactly our output.
    allowed = {
        "angelanexus_android/bridge.go",
        "angelanexus_android/lifecycle.go",
        "angelanexus_android/library.go",
        "angelanexus_android/bridge_integration_test.go",
        "angelanexus_android/library_integration_test.go",
        "tunnel/statistic/angelanexus_statistics_test.go",
        "tunnel/statistic/angelanexus_late_connections_test.go",
        "component/nat/table.go",
        "tunnel/connection.go",
        "component/sniffer/angelanexus_quic_sender_integration_test.go",
        "tunnel/angelanexus_late_tunnel_test.go",
    }
    for line in dirty.splitlines():
        path = line[3:] if len(line) >= 4 else ""
        if path == "listener/sing_tun/server.go" and patched_hash == PATCHED_SERVER_SHA256:
            continue
        if path == "component/nat/table.go" and nat_table_hash == PATCHED_NAT_TABLE_SHA256:
            continue
        if path == "tunnel/connection.go" and connection_hash == PATCHED_CONNECTION_SHA256:
            continue
        if path == "tunnel/statistic/manager.go" and statistics_hash in (PATCHED_STATISTICS_SHA256, PATCHED_LATE_MANAGER_SHA256):
            continue
        if path == "tunnel/statistic/tracker.go" and tracker_hash == PATCHED_TRACKER_SHA256:
            continue
        if path == "component/sniffer/quic_sniffer.go" and quic_sniffer_hash == PATCHED_QUIC_SNIFFER_SHA256:
            continue
        if path == "tunnel/tunnel.go" and tunnel_hash == PATCHED_TUNNEL_SHA256:
            continue
        if path and path not in allowed:
            fail(f"dirty checkout has unexpected path: {path}")
    for rel, expected in EXPECTED.items():
        path = root / rel
        if not path.is_file():
            fail(f"missing pinned source file: {rel}")
        actual_hash = sha256(path)
        if actual_hash != expected:
            # A patched server.go is handled below, but every other source must
            # remain pristine.  Idempotent reruns are checked by markers.
            if rel == "listener/sing_tun/server.go" and patched_hash == PATCHED_SERVER_SHA256:
                continue
            if rel == "component/nat/table.go" and nat_table_hash == PATCHED_NAT_TABLE_SHA256:
                continue
            if rel == "tunnel/connection.go" and connection_hash == PATCHED_CONNECTION_SHA256:
                continue
            if rel == "tunnel/statistic/manager.go" and statistics_hash in (PATCHED_STATISTICS_SHA256, PATCHED_LATE_MANAGER_SHA256):
                continue
            if rel == "tunnel/statistic/tracker.go" and tracker_hash == PATCHED_TRACKER_SHA256:
                continue
            if rel == "component/sniffer/quic_sniffer.go" and quic_sniffer_hash == PATCHED_QUIC_SNIFFER_SHA256:
                continue
            if rel == "tunnel/tunnel.go" and tunnel_hash == PATCHED_TUNNEL_SHA256:
                continue
            fail(f"sha256 mismatch for {rel}: {actual_hash} != {expected}")
    mod = (root / "go.mod").read_text()
    if "github.com/metacubex/sing-tun v0.4.27" not in mod:
        fail("go.mod does not pin github.com/metacubex/sing-tun v0.4.27")
    try:
        import json
        module_data = json.loads(subprocess.check_output(["go", "mod", "download", "-json", "github.com/metacubex/sing-tun@v0.4.27"], cwd=root, text=True))
    except (OSError, subprocess.CalledProcessError, ValueError) as exc:
        fail(f"cannot resolve sing-tun v0.4.27 with go mod download: {exc}")
    if module_data.get("Version") != "v0.4.27" or not module_data.get("Dir"):
        fail("go resolved an unexpected sing-tun module")
    module = Path(module_data["Dir"])
    if f"github.com/metacubex/sing-tun v0.4.27 {module_data.get('Sum')}" not in (root / "go.sum").read_text():
        fail("sing-tun module checksum is not present in pinned go.sum")
    tun_linux = module / "tun_linux.go"
    if not tun_linux.is_file() or sha256(tun_linux) != SING_TUN_TUN_LINUX_SHA256:
        fail("sing-tun v0.4.27 tun_linux.go is missing or does not match the pinned implementation")
    if "func New(options Options) (Tun, error)" not in tun_linux.read_text():
        fail("sing-tun tun_linux.go does not expose the expected New implementation")


def apply(root: Path) -> None:
    path = root / "listener/sing_tun/server.go"
    text = path.read_text()
    if "func NewWithOwnedFD(" in text and "func newListener(" in text:
        return
    if "func NewWithOwnedFD(" in text or "ownedFD :=" in text:
        fail("partially applied owned-FD adapter; refusing to guess")
    old_import = '\t"sync"\n\t"time"'
    if old_import not in text:
        fail("server.go import anchor changed")
    text = text.replace(old_import, '\t"sync"\n\t"syscall"\n\t"time"', 1)
    old = 'func New(options LC.Tun, tunnel C.Tunnel, additions ...inbound.Addition) (l *Listener, err error) {'
    new = '''func New(options LC.Tun, tunnel C.Tunnel, additions ...inbound.Addition) (l *Listener, err error) {
return newListener(options, tunnel, false, additions...)
}

// NewWithOwnedFD consumes options.FileDescriptor on every normal return.
// It is intentionally restricted to Android/Linux; callers retain ownership on
// unsupported platforms or invalid descriptors.
func NewWithOwnedFD(options LC.Tun, tunnel C.Tunnel, additions ...inbound.Addition) (l *Listener, err error) {
if runtime.GOOS != "android" && runtime.GOOS != "linux" {
return nil, E.New("owned TUN fd is supported only on Android/Linux")
}
if options.FileDescriptor < 3 {
return nil, E.New("owned TUN fd must be >= 3")
}
return newListener(options, tunnel, true, additions...)
}

func newListener(options LC.Tun, tunnel C.Tunnel, ownsFD bool, additions ...inbound.Addition) (l *Listener, err error) {
ownedFD := 0
if ownsFD {
ownedFD = options.FileDescriptor
}
defer func() {
if ownedFD > 0 {
_ = syscall.Close(ownedFD)
}
}()'''
    if text.count(old) != 1:
        fail("New function anchor changed")
    text = text.replace(old, new, 1)
    old_tun = "\tif err != nil {\n\t\terr = E.Cause(err, \"configure tun interface\")\n\t\treturn\n\t}\n\n\tl.dnsServerIp = dnsServerIp"
    new_tun = "\tif err != nil {\n\t\terr = E.Cause(err, \"configure tun interface\")\n\t\treturn\n\t}\n\tl.tunIf = tunIf\n\townedFD = 0\n\n\tl.dnsServerIp = dnsServerIp"
    if text.count(old_tun) != 1:
        fail("tunIf ownership handoff anchor changed")
    text = text.replace(old_tun, new_tun, 1)
    old_late = "\tl.tunIf = tunIf\n\n\ttunStack, err := tun.NewStack"
    if text.count(old_late) != 1:
        fail("late tunIf assignment anchor changed")
    text = text.replace(old_late, "\ttunStack, err := tun.NewStack", 1)
    # Format and verify in memory before replacing the pinned source file.
    try:
        formatted = subprocess.check_output(["gofmt"], input=text.encode())
    except (OSError, subprocess.CalledProcessError) as exc:
        fail(f"gofmt failed before patch: {exc}")
    if hashlib.sha256(formatted).hexdigest() != PATCHED_SERVER_SHA256:
        fail("adapted server.go does not match the reviewed output digest")
    path.write_bytes(formatted)


def apply_statistics(root: Path) -> None:
    patch = Path(__file__).with_name("statistics.patch")
    if not patch.is_file() or sha256(patch) != STATISTICS_PATCH_SHA256:
        fail("statistics.patch is missing or does not match the reviewed patch digest")
    path = root / "tunnel/statistic/manager.go"
    digest = sha256(path)
    if digest in (PATCHED_STATISTICS_SHA256, PATCHED_LATE_MANAGER_SHA256):
        return
    if digest != EXPECTED["tunnel/statistic/manager.go"]:
        fail("statistics manager does not match the pinned source")
    # Compute and check the exact output before replacing upstream source. Never
    # run arbitrary patch paths in the checkout, or accept marker-only patches.
    with tempfile.TemporaryDirectory(prefix="angelanexus-statistics-") as tmp:
        output = Path(tmp) / "manager.go"
        try:
            subprocess.run(["patch", "--batch", "--silent", "--output", str(output),
                            str(path), str(patch)], check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError) as exc:
            fail(f"statistics patch failed before source replacement: {exc}")
        if not output.is_file() or sha256(output) != PATCHED_STATISTICS_SHA256:
            fail("adapted statistics manager does not match the reviewed output digest")
        path.write_bytes(output.read_bytes())


def apply_late(root: Path) -> None:
    patch = Path(__file__).with_name("late-connections.patch")
    if not patch.is_file() or sha256(patch) != LATE_CONNECTIONS_PATCH_SHA256:
        fail("late-connections.patch is missing or does not match the reviewed patch digest")
    paths = {"tunnel/statistic/manager.go": PATCHED_LATE_MANAGER_SHA256,
             "tunnel/statistic/tracker.go": PATCHED_TRACKER_SHA256,
             "tunnel/tunnel.go": PATCHED_TUNNEL_SHA256,
             "component/nat/table.go": PATCHED_NAT_TABLE_SHA256,
             "tunnel/connection.go": PATCHED_CONNECTION_SHA256,
             "component/sniffer/quic_sniffer.go": PATCHED_QUIC_SNIFFER_SHA256}
    if all(sha256(root / rel) == digest for rel, digest in paths.items()):
        return
    inputs = {"tunnel/statistic/manager.go": PATCHED_STATISTICS_SHA256,
              "tunnel/statistic/tracker.go": EXPECTED["tunnel/statistic/tracker.go"],
              "tunnel/tunnel.go": EXPECTED["tunnel/tunnel.go"],
              "component/nat/table.go": EXPECTED["component/nat/table.go"],
              "tunnel/connection.go": EXPECTED["tunnel/connection.go"],
              "component/sniffer/quic_sniffer.go": EXPECTED["component/sniffer/quic_sniffer.go"]}
    for rel, digest in inputs.items():
        if sha256(root / rel) != digest:
            fail(f"late patch input {rel} does not match reviewed source")
    # Parse only the exact five reviewed sections and patch into temporary
    # outputs. Never let patch mutate the checkout before every digest matches.
    import re
    sections = re.split(r"(?m)(?=^--- )", patch.read_text())
    sections = [section for section in sections if section]
    if len(sections) != len(paths):
        fail("late patch must contain exactly the reviewed six source sections")
    outputs = {}
    with tempfile.TemporaryDirectory(prefix="angelanexus-late-") as tmp:
        for index, (rel, digest) in enumerate(paths.items()):
            section = sections[index]
            if not section.startswith(f"--- {rel}\n+++ {rel}\n"):
                fail(f"late patch section path mismatch: {rel}")
            section_path = Path(tmp) / f"{index}.patch"
            section_path.write_text(section)
            output = Path(tmp) / f"{index}.go"
            try:
                subprocess.run(["patch", "--batch", "--silent", "--output", str(output),
                                str(root / rel), str(section_path)], check=True, capture_output=True)
            except (OSError, subprocess.CalledProcessError) as exc:
                fail(f"late-connections patch failed before source replacement: {exc}")
            if not output.is_file() or sha256(output) != digest:
                fail(f"late patched {rel} digest mismatch before source replacement")
            outputs[rel] = output.read_bytes()
    for rel, content in outputs.items():
        (root / rel).write_bytes(content)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="pinned mihomo checkout")
    args = parser.parse_args()
    root = args.source.resolve()
    verify_source(root)
    apply(root)
    apply_statistics(root)
    apply_late(root)
    print(f"prepared {root} for sing-tun {SING_TUN_VERSION} owned FD and joinable statistics")


if __name__ == "__main__":
    main()
