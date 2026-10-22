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
    "listener/mixed/mixed.go": "dcc7a92d339611f5c173f1c533db4e21c496ef8effc15374f7889dbec388eb18",
    "listener/listener.go": "1a11cda3fb4a87875d817fe29f1e79973cb8cb6eeccc0ae5e22db15df1277758",
    "adapter/outbound/dns.go": "2b2956d533f11e2cd139c060d4b5e95f7a7f2cf9f52c03ee63cd9f1bdd507887",
    "adapter/outbound/socks5.go": "e868055e8ce0d9f011d6b602d28977f8297d0e9d31e57306c68458527694aa9b",
    "ntp/ntp/service.go": "a6c52da96e76dce97155830276270b47d69ebe99bf2a1896f5bee25fd40d017d",
    "dns/client.go": "b11cea570b82d782aa222a1fa994a91534aa845e340ffac0cc55b3fce7fad9c6",
    "dns/dot.go": "0c018bc055d511c0e87dfdc36c64cc4a1dcd88b6f07251a37864820749a62049",
    "dns/dhcp.go": "0e3f4b9faae24e1c3b0928a5876cd6fe0986ebf8649f88e31c63ea492a07a5dc",
    "dns/util.go": "24831a2b5e10fe3b8d074d537a1512025adc298968b3afa6bdef0ac3e10bae6e",
    "component/dhcp/dhcp.go": "ce31f33684bfa587249e2559aead5a03567ad61613d8e6773b5ec3685ad5ee07",
    "dns/doh.go": "1ba0170bed4aabf6b295471f9fddb03da20122d339526a97170dff537fbde57b",
    "dns/server.go": "a825b81da408052892bbc5333525e39a79eff5113895ae63cc0bcc60442d763b",
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
    "adapter/provider/healthcheck.go": "b3108ef1530c2bb28ff75928c64dc7150e68e2bb38f4f82e110ebdaff1801c64",
    "adapter/provider/provider.go": "69cb24313f68cc457c5f4e45ecab0d1355c1f5d22e3e2ec0559a7d753ee1672f",
}
# sing-tun is supplied by Go's module cache; verify the implementation that
# accepts an already-open fd, not merely the version string in go.mod.
SING_TUN_TUN_LINUX_SHA256 = "34d3c504a859006bf2981709d86e104c9a2b7c9542ef5895201ce2a723ecac54"
PATCHED_SERVER_SHA256 = "1a77f3a7416b8074bc5e91c4944079c059fe766991bccfaa921780ad0068b8e1"
PATCHED_STATISTICS_SHA256 = "316e372b7de3735a9a44c8f2357092ee1023fb21c6bbb899ea6a5228cc1dbb09"
STATISTICS_PATCH_SHA256 = "293330f8b4ba6ed0fb318ea43f5bb759b0946fa98f44c563131135441d4c124b"
LATE_CONNECTIONS_PATCH_SHA256 = "d83f2367fa8eff8fc85ade50c6e766b60a8e56a01a4c5063317840ac52926042"
PATCHED_LATE_MANAGER_SHA256 = "3b72343588f7d84cd6665798dc454fee02af2caaf9afe27177c337f9b6dc02ca"
PATCHED_TPROXY_PACKET_SHA256 = "f417e4776d8dcdeb97b194fff2de83b76f3cf8e181ae01ee3fc15218fb376c5f"
PATCHED_NAT_TABLE_SHA256 = "a024e1281fea19bdfcf67d4b8b72f9924d87bcd45a0d603a4e7555e05dd447d4"
PATCHED_CONNECTION_SHA256 = "7f49df0990618e61ae9c4bd6763a80a7da0627ee1a0ec6fa44c68f7301f1c87a"
PATCHED_TRACKER_SHA256 = "790b996d9e8144ecc453c6624b11664f2956d068e8ccb284f046be9afc09c99b"
PATCHED_QUIC_SNIFFER_SHA256 = "51a3e923cf1d58a5fe05c43793bb53f5edfb588e61cafd6d7f82d42e4dd11a9b"
PATCHED_TUNNEL_SHA256 = "380428b14dc6e45b6f52298df87cdec24601b2188d5358aacb2d2e0e14c1224c"

PATCHED_DNS_RESOLVER_SHA256 = "c441ac4c55af90b7afc0e1c3d7bfba34ac0885f4941e68daa95db66666072ecc"


PATCHED_LOG_SHA256 = "0e81036280690bc39feabdb54181f805663706dc17c7c42060b7db4249b3e70b"

PATCHED_PROVIDER_FETCHER_SHA256 = "9712e8b28c32345bd186696e2cd6b6048a91a3f7904eb4f4b13da2a742a062b9"
# Exact reviewed outputs for the joinable provider health-check adapter.
PATCHED_PROVIDER_HEALTHCHECK_SHA256 = "ec8bbc125c942b0aab0e2953e9eef070f5d2a9f3c54092388f3c80efe9ce6e1a"
PATCHED_PROXY_PROVIDER_SHA256 = "3bb335935a0599ef6c4f05d72e52a13ee7fa35f9dee79f093a7e340685800a06"

PATCHED_DNS_DOH_SHA256 = "f23acc9aec7d8d93c8bb10de507b7dca536877076880240fec037383bf847c8d"

PATCHED_DNS_SERVER_SHA256 = "fdf923b1091f6440a843443609a61f2da6adb5ebd02e114c3731a3b0134b9a46"

PATCHED_DNS_CLIENT_SHA256 = "6b3118ba290776ed661fdaeb0dc6d7728329a6e55f1b966b5f3fe15b863b8b25"
PATCHED_DNS_TLS_SHA256 = "b810d265b0b7c468b0c1eb6c846e8a70365dc07eca054b1fa287b3a8f18ffad6"
PATCHED_DNS_DHCP_SHA256 = "f2ac556bfe0475b39f01d494c99abceb7d93086f1fd6fbd503641315fc53896a"
PATCHED_DNS_UTIL_SHA256 = "aee38a085812395c5719b149abdb1a475082c43a64df32fa21894a137944b8b1"
PATCHED_DHCP_DISCOVERY_SHA256 = "6db2c7543c69d5e36ac68345f6071e9bbc72b63f97e9e37e3939500bd8c38bdb"

# Exact reviewed NTP worker cancellation/join output.
PATCHED_NTP_SERVICE_SHA256 = "5dd6dabf7bd64e2932a928c30f23c7f759ff9ac9314060c1dd562f2995b9677c"

PATCHED_DNS_OUTBOUND_SHA256 = "44504fa3a38ed2182fa222be5ec7d364dcf25599fb3de3900782076ccf368184"

PATCHED_SOCKS5_SHA256 = "71d197060a3a66dab3c9c89ddb2a0be206f858c3f7e5cd5e6a51a608ddd50855"

PATCHED_MIXED_SHA256 = "5547c95db4f622abf6e182e54ba3bea9bd7feaedd9947b96d7a63e60d7167c3d"
PATCHED_MIXED_REGISTRY_SHA256 = "060fa4dadfa0f0bce77b5c21155e757b96e88e15871d6491130d57c217d3edcb"
PATCHED_LISTENER_SHA256 = "687b7f599cfa2d7f8f7a59ea9cba1305adbecd686f1365c02baf8c6239848a9b"
MIXED_LIFECYCLE_PATCH_SHA256 = "e02eec2a86faa103e094e4050b3272c5d9378a2d22f6d6eb9deeb3f6a9504b3d"

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
    dns_doh_hash = sha256(root / "dns/doh.go") if (root / "dns/doh.go").is_file() else None
    extra_source_hashes = {
        "listener/mixed/mixed.go": PATCHED_MIXED_SHA256,
        "listener/mixed/lifecycle.go": PATCHED_MIXED_REGISTRY_SHA256,
        "listener/listener.go": PATCHED_LISTENER_SHA256,
        "adapter/outbound/dns.go": PATCHED_DNS_OUTBOUND_SHA256,
        "adapter/outbound/socks5.go": PATCHED_SOCKS5_SHA256,
        "ntp/ntp/service.go": PATCHED_NTP_SERVICE_SHA256,
        "dns/client.go": PATCHED_DNS_CLIENT_SHA256,
        "dns/dot.go": PATCHED_DNS_TLS_SHA256,
        "dns/dhcp.go": PATCHED_DNS_DHCP_SHA256,
        "dns/util.go": PATCHED_DNS_UTIL_SHA256,
        "component/dhcp/dhcp.go": PATCHED_DHCP_DISCOVERY_SHA256,
    }
    dns_server = root / "dns/server.go"
    dns_server_hash = sha256(dns_server) if dns_server.is_file() else None
    dns_resolver = root / "dns/resolver.go"
    dns_resolver_hash = sha256(dns_resolver) if dns_resolver.is_file() else None
    provider_fetcher = root / "component/resource/fetcher.go"
    provider_fetcher_hash = sha256(provider_fetcher) if provider_fetcher.is_file() else None
    provider_healthcheck = root / "adapter/provider/healthcheck.go"
    provider_healthcheck_hash = sha256(provider_healthcheck) if provider_healthcheck.is_file() else None
    proxy_provider = root / "adapter/provider/provider.go"
    proxy_provider_hash = sha256(proxy_provider) if proxy_provider.is_file() else None
    log_source = root / "log/log.go"
    log_hash = sha256(log_source) if log_source.is_file() else None
    # Existing adapter output is allowed only when it is exactly our output.
    allowed = {
        "listener/mixed/angelanexus_mixed_lifecycle_integration_test.go",
        "listener/angelanexus_mixed_recreate_integration_test.go",
        "angelanexus_android/bridge_mixed_integration_test.go",
        "adapter/outbound/angelanexus_dns_outbound_lifecycle_integration_test.go",
        "adapter/outbound/angelanexus_socks5_lifecycle_integration_test.go",
        "ntp/ntp/angelanexus_ntp_lifecycle_integration_test.go",
        "angelanexus_android/bridge_ntp_integration_test.go",
        "log/angelanexus_log_level_integration_test.go",
        "component/resource/angelanexus_provider_lifecycle_integration_test.go",
        "adapter/provider/angelanexus_healthcheck_lifecycle_integration_test.go",
        "dns/angelanexus_dns_doh_lifecycle_integration_test.go",
        "dns/angelanexus_dns_reset_integration_test.go",
        "dns/angelanexus_dns_resolver_lifecycle_integration_test.go",
        "dns/angelanexus_dns_transport_generation_integration_test.go",
        "component/dhcp/angelanexus_dhcp_discovery_lifecycle_integration_test.go",
        "dns/angelanexus_dns_server_lifecycle_integration_test.go",
        "angelanexus_android/bridge_dns_integration_test.go",
        "angelanexus_android/bridge.go",
        "angelanexus_android/lifecycle.go",
        "angelanexus_android/library.go",
        "angelanexus_android/bridge_integration_test.go",
        "angelanexus_android/bridge_healthcheck_integration_test.go",
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
        if path in extra_source_hashes and sha256(root / path) == extra_source_hashes[path]:
            continue
        if path in extra_source_hashes:
            fail(f"dirty adapted source has an unreviewed digest: {path}")
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
        if path == "adapter/provider/healthcheck.go" and provider_healthcheck_hash == PATCHED_PROVIDER_HEALTHCHECK_SHA256:
            continue
        if path == "adapter/provider/provider.go" and proxy_provider_hash == PATCHED_PROXY_PROVIDER_SHA256:
            continue
        if path == "dns/doh.go" and dns_doh_hash == PATCHED_DNS_DOH_SHA256:
            continue
        if path == "dns/server.go" and dns_server_hash == PATCHED_DNS_SERVER_SHA256:
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
            if rel in extra_source_hashes and actual_hash == extra_source_hashes[rel]:
                continue
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
            if rel == "adapter/provider/healthcheck.go" and provider_healthcheck_hash == PATCHED_PROVIDER_HEALTHCHECK_SHA256:
                continue
            if rel == "adapter/provider/provider.go" and proxy_provider_hash == PATCHED_PROXY_PROVIDER_SHA256:
                continue
            if rel == "dns/doh.go" and dns_doh_hash == PATCHED_DNS_DOH_SHA256:
                continue
            if rel == "dns/server.go" and dns_server_hash == PATCHED_DNS_SERVER_SHA256:
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
             "dns/server.go": PATCHED_DNS_SERVER_SHA256,
             "dns/doh.go": PATCHED_DNS_DOH_SHA256,
             "component/resource/fetcher.go": PATCHED_PROVIDER_FETCHER_SHA256,
             "log/log.go": PATCHED_LOG_SHA256,
             "adapter/provider/healthcheck.go": PATCHED_PROVIDER_HEALTHCHECK_SHA256,
             "adapter/provider/provider.go": PATCHED_PROXY_PROVIDER_SHA256,
             "dns/client.go": PATCHED_DNS_CLIENT_SHA256,
             "dns/dot.go": PATCHED_DNS_TLS_SHA256,
             "dns/dhcp.go": PATCHED_DNS_DHCP_SHA256,
             "dns/util.go": PATCHED_DNS_UTIL_SHA256,
             "component/dhcp/dhcp.go": PATCHED_DHCP_DISCOVERY_SHA256,
             "ntp/ntp/service.go": PATCHED_NTP_SERVICE_SHA256,
             "adapter/outbound/socks5.go": PATCHED_SOCKS5_SHA256,
             "adapter/outbound/dns.go": PATCHED_DNS_OUTBOUND_SHA256}
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
              "dns/server.go": EXPECTED["dns/server.go"],
              "dns/doh.go": EXPECTED["dns/doh.go"],
              "component/resource/fetcher.go": EXPECTED["component/resource/fetcher.go"],
              "log/log.go": EXPECTED["log/log.go"],
             "adapter/provider/healthcheck.go": EXPECTED["adapter/provider/healthcheck.go"],
             "adapter/provider/provider.go": EXPECTED["adapter/provider/provider.go"],
             "dns/client.go": EXPECTED["dns/client.go"],
             "dns/dot.go": EXPECTED["dns/dot.go"],
             "dns/dhcp.go": EXPECTED["dns/dhcp.go"],
             "dns/util.go": EXPECTED["dns/util.go"],
             "component/dhcp/dhcp.go": EXPECTED["component/dhcp/dhcp.go"],
             "ntp/ntp/service.go": EXPECTED["ntp/ntp/service.go"],
             "adapter/outbound/socks5.go": EXPECTED["adapter/outbound/socks5.go"],
             "adapter/outbound/dns.go": EXPECTED["adapter/outbound/dns.go"]}
    for rel, digest in inputs.items():
        if sha256(root / rel) != digest:
            fail(f"late patch input {rel} does not match reviewed source")
    # Parse only the exact reviewed sections and patch into temporary
    # outputs. Never let patch mutate the checkout before every digest matches.
    import re
    sections = re.split(r"(?m)(?=^--- )", patch.read_text())
    sections = [section for section in sections if section]
    if len(sections) != len(paths):
        fail("late patch must contain exactly the reviewed source sections")
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

def apply_mixed(root: Path) -> None:
    patch = Path(__file__).with_name("mixed-lifecycle.patch")
    if not patch.is_file() or sha256(patch) != MIXED_LIFECYCLE_PATCH_SHA256:
        fail("mixed-lifecycle.patch does not match the reviewed patch digest")
    paths = {"listener/mixed/mixed.go": PATCHED_MIXED_SHA256,
             "listener/mixed/lifecycle.go": PATCHED_MIXED_REGISTRY_SHA256,
             "listener/listener.go": PATCHED_LISTENER_SHA256}
    if all((root / rel).is_file() and sha256(root / rel) == digest for rel, digest in paths.items()):
        return
    for rel in paths:
        path = root / rel
        if rel == "listener/mixed/lifecycle.go":
            if path.exists():
                fail("mixed registry helper must be absent before patch application")
        elif sha256(path) != EXPECTED[rel]:
            fail(f"mixed patch input {rel} does not match reviewed source")
    import re
    sections = [part for part in re.split(r"(?m)(?=^--- )", patch.read_text()) if part]
    if len(sections) != len(paths):
        fail("mixed patch must contain exactly the reviewed source sections")
    outputs = {}
    with tempfile.TemporaryDirectory(prefix="angelanexus-mixed-") as tmp:
        empty = Path(tmp) / "empty"
        empty.write_bytes(b"")
        for index, (rel, digest) in enumerate(paths.items()):
            section = sections[index]
            if not section.startswith(f"--- {rel}\n+++ {rel}\n"):
                fail(f"mixed patch section path mismatch: {rel}")
            section_path = Path(tmp) / f"{index}.patch"
            section_path.write_text(section)
            output = Path(tmp) / f"{index}.go"
            input_path = root / rel if (root / rel).is_file() else empty
            try:
                subprocess.run(["patch", "--batch", "--silent", "--output", str(output),
                                str(input_path), str(section_path)], check=True, capture_output=True)
            except (OSError, subprocess.CalledProcessError) as exc:
                fail(f"mixed patch failed before source replacement: {exc}")
            if not output.is_file() or sha256(output) != digest:
                fail(f"mixed patched {rel} digest mismatch before source replacement")
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
    apply_mixed(root)
    print(f"prepared {root} for sing-tun {SING_TUN_VERSION} owned FD and joinable statistics")


if __name__ == "__main__":
    main()
