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
    "log/log.go": "5ed821bf17536b7a012506baa1fe00550451c81b7f36e291799234ccdd7940df",
    "component/resource/fetcher.go": "647fdd5906c41202974577ff96a00ebc6bda441ae3e9d7717037cedff4eee903",
    "dns/resolver.go": "400765c7dde15950c324ab8fce1a7dc1d7730b3c7f3bff6a85fd64e4238e2b48",
    "go.mod": "72b10f80ec33e2e06dee425a75e499d5818039c99d4e25f745d0bca349c90af5",
    "go.sum": "8fa2b10fe8589a4a1118fd6819f59231f74a27e71c8154de9c3903a69c3735aa",
    "listener/sing_tun/server.go": "8b0d766e346aa5a36ec40dc66c1fe7cd3466ead48a687cfb4a262342ca9a3335",
    "listener/sing_tun/server_notwindows.go": "b455a1c900fa94bde40c09b01183c28414b1bf45810ff79ba5eb58f7c34ee66c",
    "listener/tproxy/packet.go": "008ebcaea010af878b31a84148fb58e9c31e31456b651a73107a51a95c769c54",
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
LATE_CONNECTIONS_PATCH_SHA256 = "ca0570c729c3cb0b98249b01d51e32926c2391c760fef1b9046632f12bbb5fb7"
PATCHED_LATE_MANAGER_SHA256 = "3b72343588f7d84cd6665798dc454fee02af2caaf9afe27177c337f9b6dc02ca"
PATCHED_TPROXY_PACKET_SHA256 = "f417e4776d8dcdeb97b194fff2de83b76f3cf8e181ae01ee3fc15218fb376c5f"
PATCHED_NAT_TABLE_SHA256 = "a024e1281fea19bdfcf67d4b8b72f9924d87bcd45a0d603a4e7555e05dd447d4"
PATCHED_CONNECTION_SHA256 = "7f49df0990618e61ae9c4bd6763a80a7da0627ee1a0ec6fa44c68f7301f1c87a"
PATCHED_TRACKER_SHA256 = "790b996d9e8144ecc453c6624b11664f2956d068e8ccb284f046be9afc09c99b"
PATCHED_QUIC_SNIFFER_SHA256 = "51a3e923cf1d58a5fe05c43793bb53f5edfb588e61cafd6d7f82d42e4dd11a9b"
PATCHED_TUNNEL_SHA256 = "380428b14dc6e45b6f52298df87cdec24601b2188d5358aacb2d2e0e14c1224c"

PATCHED_DNS_RESOLVER_SHA256 = "4d72255d1e672cba762752dfd732353d55ada80a6bfc5bbfda5600a046c14890"


PATCHED_LOG_SHA256 = "0e81036280690bc39feabdb54181f805663706dc17c7c42060b7db4249b3e70b"

PATCHED_PROVIDER_FETCHER_SHA256 = "9712e8b28c32345bd186696e2cd6b6048a91a3f7904eb4f4b13da2a742a062b9"

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
    tproxy_packet = root / "listener/tproxy/packet.go"
    tproxy_packet_hash = sha256(tproxy_packet) if tproxy_packet.is_file() else None
    dns_resolver = root / "dns/resolver.go"
    dns_resolver_hash = sha256(dns_resolver) if dns_resolver.is_file() else None
    provider_fetcher = root / "component/resource/fetcher.go"
    provider_fetcher_hash = sha256(provider_fetcher) if provider_fetcher.is_file() else None
    log_source = root / "log/log.go"
    log_hash = sha256(log_source) if log_source.is_file() else None
    # Existing adapter output is allowed only when it is exactly our output.
    allowed = {
        "log/angelanexus_log_level_integration_test.go",
        "component/resource/angelanexus_provider_lifecycle_integration_test.go",
        "dns/angelanexus_dns_reset_integration_test.go",
        "angelanexus_android/bridge.go",
        "angelanexus_android/lifecycle.go",
        "angelanexus_android/library.go",
        "angelanexus_android/bridge_integration_test.go",
        "angelanexus_android/library_integration_test.go",
        "tunnel/statistic/angelanexus_statistics_test.go",
        "tunnel/statistic/angelanexus_late_connections_test.go",
        "component/nat/angelanexus_nat_local_integration_test.go",
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
        if path == "log/log.go" and log_hash == PATCHED_LOG_SHA256:
            continue
        if path == "component/resource/fetcher.go" and provider_fetcher_hash == PATCHED_PROVIDER_FETCHER_SHA256:
            continue
        if path == "dns/resolver.go" and dns_resolver_hash == PATCHED_DNS_RESOLVER_SHA256:
            continue
        if path == "listener/tproxy/packet.go" and tproxy_packet_hash == PATCHED_TPROXY_PACKET_SHA256:
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
            if rel == "log/log.go" and log_hash == PATCHED_LOG_SHA256:
                continue
            if rel == "component/resource/fetcher.go" and provider_fetcher_hash == PATCHED_PROVIDER_FETCHER_SHA256:
                continue
            if rel == "dns/resolver.go" and dns_resolver_hash == PATCHED_DNS_RESOLVER_SHA256:
                continue
            if rel == "listener/tproxy/packet.go" and tproxy_packet_hash == PATCHED_TPROXY_PACKET_SHA256:
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
             "component/sniffer/quic_sniffer.go": PATCHED_QUIC_SNIFFER_SHA256,
             "listener/tproxy/packet.go": PATCHED_TPROXY_PACKET_SHA256,
             "dns/resolver.go": PATCHED_DNS_RESOLVER_SHA256,
             "component/resource/fetcher.go": PATCHED_PROVIDER_FETCHER_SHA256,
             "log/log.go": PATCHED_LOG_SHA256}
    if all(sha256(root / rel) == digest for rel, digest in paths.items()):
        return
    inputs = {"tunnel/statistic/manager.go": PATCHED_STATISTICS_SHA256,
              "tunnel/statistic/tracker.go": EXPECTED["tunnel/statistic/tracker.go"],
              "tunnel/tunnel.go": EXPECTED["tunnel/tunnel.go"],
              "component/nat/table.go": EXPECTED["component/nat/table.go"],
              "tunnel/connection.go": EXPECTED["tunnel/connection.go"],
              "component/sniffer/quic_sniffer.go": EXPECTED["component/sniffer/quic_sniffer.go"],
              "listener/tproxy/packet.go": EXPECTED["listener/tproxy/packet.go"],
              "dns/resolver.go": EXPECTED["dns/resolver.go"],
              "component/resource/fetcher.go": EXPECTED["component/resource/fetcher.go"],
              "log/log.go": EXPECTED["log/log.go"]}
    for rel, digest in inputs.items():
        if sha256(root / rel) != digest:
            fail(f"late patch input {rel} does not match reviewed source")
    # Parse only the exact ten reviewed sections and patch into temporary
    # outputs. Never let patch mutate the checkout before every digest matches.
    import re
    sections = re.split(r"(?m)(?=^--- )", patch.read_text())
    sections = [section for section in sections if section]
    if len(sections) != len(paths):
        fail("late patch must contain exactly the reviewed ten source sections")
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
