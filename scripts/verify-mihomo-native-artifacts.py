#!/usr/bin/env python3
"""Fail-closed verification of downloaded Mihomo Android native artifacts."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import sys
from pathlib import Path

ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
REPOSITORY = "https://github.com/MetaCubeX/mihomo"
EXPECTED_PLATFORM = "android"
EXPECTED_BUILD_TAGS = {"with_gvisor", "cmfa"}
EXPECTED_BUILDMODE = "c-shared"
EXPECTED_PACKAGE = "./angelanexus_android"
EXPECTED_VERSION_LDFLAG = "github.com/metacubex/mihomo/constant.Version=v1.19.32"
EXPECTED_TOOLCHAIN = {"goos": "android", "androidNdk": "28.0.13004108", "cgoEnabled": True}
EXPECTED_GOARCH = {"arm64-v8a": "arm64", "armeabi-v7a": "arm", "x86_64": "amd64"}
HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")
ADAPTER_PATH = "native/android/mihomo-bridge/prepare-upstream.py"
PATCHED_SOURCE_PATH = "listener/sing_tun/server.go"
DNS_RESOLVER_PATH = "dns/resolver.go"
DNS_SERVER_PATH = "dns/server.go"
DNS_DOH_PATH = "dns/doh.go"
DNS_CLIENT_PATH = "dns/client.go"
DNS_TLS_PATH = "dns/dot.go"
DNS_DHCP_PATH = "dns/dhcp.go"
DNS_UTIL_PATH = "dns/util.go"
DHCP_DISCOVERY_PATH = "component/dhcp/dhcp.go"
NTP_SERVICE_PATH = "ntp/ntp/service.go"
PROVIDER_FETCHER_PATH = "component/resource/fetcher.go"
STATISTICS_PATCH_PATH = "native/android/mihomo-bridge/statistics.patch"
PATCHED_STATISTICS_PATH = "tunnel/statistic/manager.go"
LATE_CONNECTIONS_PATCH_PATH = "native/android/mihomo-bridge/late-connections.patch"
PATCHED_TRACKER_PATH = "tunnel/statistic/tracker.go"
PATCHED_TUNNEL_PATH = "tunnel/tunnel.go"
PATCHED_NAT_TABLE_PATH = "component/nat/table.go"
PATCHED_CONNECTION_PATH = "tunnel/connection.go"
PATCHED_QUIC_SNIFFER_PATH = "component/sniffer/quic_sniffer.go"
PATCHED_TPROXY_PACKET_PATH = "listener/tproxy/packet.go"
LOG_PATH = "log/log.go"
PROVIDER_HEALTHCHECK_PATH = "adapter/provider/healthcheck.go"
PROXY_PROVIDER_PATH = "adapter/provider/provider.go"
DNS_OUTBOUND_PATH = "adapter/outbound/dns.go"
SOCKS5_ASSOCIATION_PATH = "adapter/outbound/socks5.go"


class VerificationError(Exception):
    pass


def fail(message: str) -> None:
    raise VerificationError(message)


def load_json(path: Path, label: str):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"missing {label}: {path}")
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"invalid {label} {path}: {exc}")


def require(mapping, key: str, label: str):
    if not isinstance(mapping, dict) or key not in mapping:
        fail(f"{label}: missing required field {key!r}")
    return mapping[key]


def require_object(mapping, key: str, label: str) -> dict:
    value = require(mapping, key, label)
    if not isinstance(value, dict):
        fail(f"{label}.{key} must be an object")
    return value


def require_string(mapping, key: str, label: str) -> str:
    value = require(mapping, key, label)
    if not isinstance(value, str):
        fail(f"{label}.{key} must be a string")
    return value


def require_hash(mapping, key: str, label: str) -> str:
    value = require_string(mapping, key, label)
    if not HEX64.fullmatch(value):
        fail(f"{label}.{key} must be a 64-character SHA-256 hex string")
    return value.lower()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        fail(f"cannot read artifact {path}: {exc}")
    return digest.hexdigest()


def adapter_values(repo: Path) -> tuple[str, ...]:
    """Read adapter provenance metadata without importing or executing it."""
    path = repo / ADAPTER_PATH
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"missing upstream adapter script {path}: {exc}")
    try:
        tree = ast.parse(text, filename=str(path))
    except (SyntaxError, ValueError) as exc:
        fail(f"invalid upstream adapter script {path}: {exc}")
    wanted = {"PATCHED_SERVER_SHA256": [], "PATCHED_DNS_RESOLVER_SHA256": [], "PATCHED_DNS_SERVER_SHA256": [], "PATCHED_DNS_DOH_SHA256": [], "PATCHED_DNS_CLIENT_SHA256": [], "PATCHED_DNS_TLS_SHA256": [], "PATCHED_DNS_DHCP_SHA256": [], "PATCHED_DNS_UTIL_SHA256": [], "PATCHED_PROVIDER_FETCHER_SHA256": [], "PATCHED_STATISTICS_SHA256": [], "STATISTICS_PATCH_SHA256": [], "LATE_CONNECTIONS_PATCH_SHA256": [], "PATCHED_LATE_MANAGER_SHA256": [], "PATCHED_TRACKER_SHA256": [], "PATCHED_TUNNEL_SHA256": [], "PATCHED_NAT_TABLE_SHA256": [], "PATCHED_CONNECTION_SHA256": [], "PATCHED_QUIC_SNIFFER_SHA256": [], "PATCHED_TPROXY_PACKET_SHA256": [], "PATCHED_LOG_SHA256": [], "PATCHED_PROVIDER_HEALTHCHECK_SHA256": [], "PATCHED_PROXY_PROVIDER_SHA256": [], "PATCHED_DHCP_DISCOVERY_SHA256": [], "PATCHED_NTP_SERVICE_SHA256": [], "PATCHED_SOCKS5_SHA256": [], "PATCHED_DNS_OUTBOUND_SHA256": []}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        else:
            continue
        names = [target.id for target in targets if isinstance(target, ast.Name)]
        for name in names:
            if name not in wanted:
                continue
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError, SyntaxError):
                fail(f"upstream adapter {name} must be a literal string")
            if not isinstance(value, str) or not HEX64.fullmatch(value):
                fail(f"upstream adapter {name} must be a 64-character SHA-256 hex string")
            wanted[name].append(value.lower())
    for name, values in wanted.items():
        if len(values) != 1:
            fail(f"upstream adapter must define exactly one {name} constant")
    return (sha256(path), wanted["PATCHED_SERVER_SHA256"][0], wanted["PATCHED_DNS_RESOLVER_SHA256"][0], wanted["PATCHED_DNS_SERVER_SHA256"][0], wanted["PATCHED_DNS_DOH_SHA256"][0], wanted["PATCHED_DNS_CLIENT_SHA256"][0], wanted["PATCHED_DNS_TLS_SHA256"][0], wanted["PATCHED_DNS_DHCP_SHA256"][0], wanted["PATCHED_DNS_UTIL_SHA256"][0], wanted["PATCHED_PROVIDER_FETCHER_SHA256"][0], wanted["STATISTICS_PATCH_SHA256"][0], wanted["PATCHED_STATISTICS_SHA256"][0], wanted["LATE_CONNECTIONS_PATCH_SHA256"][0], wanted["PATCHED_LATE_MANAGER_SHA256"][0], wanted["PATCHED_TRACKER_SHA256"][0], wanted["PATCHED_TUNNEL_SHA256"][0], wanted["PATCHED_NAT_TABLE_SHA256"][0], wanted["PATCHED_CONNECTION_SHA256"][0], wanted["PATCHED_QUIC_SNIFFER_SHA256"][0], wanted["PATCHED_TPROXY_PACKET_SHA256"][0], wanted["PATCHED_LOG_SHA256"][0], wanted["PATCHED_PROVIDER_HEALTHCHECK_SHA256"][0], wanted["PATCHED_PROXY_PROVIDER_SHA256"][0], wanted["PATCHED_DHCP_DISCOVERY_SHA256"][0], wanted["PATCHED_NTP_SERVICE_SHA256"][0], wanted["PATCHED_SOCKS5_SHA256"][0], wanted["PATCHED_DNS_OUTBOUND_SHA256"][0])


def manifest_values(repo: Path) -> tuple[str, str, str, dict[str, str]]:
    path = repo / "native/android/app/src/main/kotlin/app/angelanexus/MihomoNativeArtifactManifest.kt"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"missing Kotlin Mihomo manifest {path}: {exc}")
    version = re.search(r'const val VERSION = "([^"]+)"', text)
    commit = re.search(r'const val SOURCE_COMMIT = "([0-9a-f]{40})"', text)
    if not version or not commit:
        fail(f"Kotlin Mihomo manifest is missing VERSION or SOURCE_COMMIT: {path}")
    source_hash = re.search(r'const val PATCHED_TPROXY_PACKET_SHA256 = "([0-9a-f]{64})"', text)
    if not source_hash:
        fail(f"Kotlin Mihomo manifest is missing PATCHED_TPROXY_PACKET_SHA256: {path}")
    hashes: dict[str, str] = {}
    specs = re.findall(r"MihomoNativeLibrarySpec\s*\(([^()]*)\)", text, re.S)
    if not specs:
        fail(f"Kotlin Mihomo manifest has no MihomoNativeLibrarySpec blocks: {path}")
    for spec in specs:
        abi_match = re.search(r'\babi\s*=\s*"([^"]+)"', spec)
        sha_match = re.search(r'\bsha256\s*=\s*"([^"]*)"', spec)
        if not abi_match:
            fail(f"Kotlin Mihomo manifest spec is missing abi: {path}")
        abi = abi_match.group(1)
        if abi in hashes:
            fail(f"Kotlin Mihomo manifest has duplicate ABI spec {abi}")
        if not sha_match or not HEX64.fullmatch(sha_match.group(1)):
            fail(f"Kotlin Mihomo manifest has no valid hash for ABI {abi}")
        hashes[abi] = sha_match.group(1).lower()
    for abi in ABIS:
        if abi not in hashes:
            fail(f"Kotlin Mihomo manifest has no complete spec for ABI {abi}")
    return version.group(1), commit.group(1), source_hash.group(1).lower(), hashes


def verify(artifacts_root: Path, repo: Path) -> None:
    version, commit, manifest_tproxy_hash, manifest_hashes = manifest_values(repo)
    adapter_hash, patched_source_hash, dns_resolver_hash, dns_server_hash, dns_doh_hash, dns_client_hash, dns_tls_hash, dns_dhcp_hash, dns_util_hash, provider_fetcher_hash, statistics_patch_hash, patched_statistics_hash, late_patch_hash, late_manager_hash, tracker_hash, tunnel_hash, nat_table_hash, connection_hash, quic_sniffer_hash, tproxy_packet_hash, log_hash, provider_healthcheck_hash, proxy_provider_hash, dhcp_discovery_hash, ntp_service_hash, socks5_hash, dns_outbound_hash = adapter_values(repo)
    if manifest_tproxy_hash != tproxy_packet_hash:
        fail(f"Kotlin manifest TProxy packet SHA-256 mismatch: manifest {manifest_tproxy_hash}, adapter {tproxy_packet_hash}")
    actual_statistics_patch_hash = sha256(repo / STATISTICS_PATCH_PATH)
    actual_late_patch_hash = sha256(repo / LATE_CONNECTIONS_PATCH_PATH)
    if actual_late_patch_hash != late_patch_hash:
        fail(f"late connections patch SHA-256 mismatch: checkout {actual_late_patch_hash}, adapter {late_patch_hash}")
    if actual_statistics_patch_hash != statistics_patch_hash:
        fail(f"statistics patch SHA-256 mismatch: checkout {actual_statistics_patch_hash}, adapter {statistics_patch_hash}")
    if version != "v1.19.32":
        fail(f"manifest version mismatch: expected v1.19.32, got {version}")
    compliance = load_json(repo / "docs/upstream/MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json", "upstream compliance JSON")
    runtime = require_object(compliance, "runtime", "compliance")
    if require(runtime, "kernel", "compliance.runtime") != "mihomo":
        fail("compliance runtime kernel is not mihomo")
    if require(runtime, "version", "compliance.runtime") != version.removeprefix("v"):
        fail("compliance version does not match Kotlin manifest")
    if require(runtime, "platform", "compliance.runtime") != EXPECTED_PLATFORM:
        fail("compliance platform is not android")
    abis = require(runtime, "abis", "compliance.runtime")
    if not isinstance(abis, list) or not all(isinstance(abi, str) for abi in abis):
        fail("compliance.runtime.abis must be a list of strings")
    if tuple(abis) != ABIS:
        fail("compliance ABI list does not exactly match required ABIs")
    source = require_object(compliance, "source", "compliance")
    if require(source, "repository", "compliance.source") != REPOSITORY:
        fail("compliance source repository mismatch")
    if require(source, "pinnedCommit", "compliance.source") != commit:
        fail("compliance pinned commit does not match Kotlin manifest")
    documented = require(compliance, "artifacts", "compliance")
    if not isinstance(documented, dict):
        fail("compliance artifacts must be an object")

    for abi in ABIS:
        root = artifacts_root / abi
        if not root.is_dir():
            fail(f"missing artifact directory for ABI {abi}: {root}")
        entries = list(root.iterdir())
        expected_names = {f"libclash-{abi}.so", f"mihomo-provenance-{abi}.json"}
        actual_names = {entry.name for entry in entries}
        if actual_names != expected_names or any(not entry.is_file() for entry in entries):
            fail(f"ABI {abi} must contain exactly {sorted(expected_names)}, found {sorted(actual_names)}")
        artifact = root / f"libclash-{abi}.so"
        provenance_path = root / f"mihomo-provenance-{abi}.json"
        actual_hash = sha256(artifact)
        expected_hash = manifest_hashes[abi]
        if actual_hash != expected_hash:
            fail(f"ABI {abi} artifact SHA-256 mismatch: computed {actual_hash}, manifest {expected_hash}")
        record = load_json(provenance_path, f"provenance for {abi}")
        if not isinstance(record, dict):
            fail(f"provenance {abi} must be an object")
        if require(record, "version", f"provenance {abi}") != 1:
            fail(f"provenance {abi} version must be 1")
        if require(record, "kernel", f"provenance {abi}") != "mihomo":
            fail(f"provenance {abi} kernel mismatch")
        if require(record, "kernelVersion", f"provenance {abi}") != version.removeprefix("v"):
            fail(f"provenance {abi} version mismatch")
        if require(record, "platform", f"provenance {abi}") != EXPECTED_PLATFORM:
            fail(f"provenance {abi} platform mismatch")
        if require(record, "abi", f"provenance {abi}") != abi:
            fail(f"provenance ABI mismatch: expected {abi}")
        psource = require_object(record, "source", f"provenance {abi}")
        if require(psource, "repository", f"provenance.source {abi}") != REPOSITORY:
            fail(f"provenance {abi} source repository mismatch")
        if require(psource, "commit", f"provenance.source {abi}") != commit:
            fail(f"provenance {abi} source commit mismatch")
        adapter = require_object(record, "ownershipAdapter", f"provenance {abi}")
        if require(adapter, "path", f"provenance.ownershipAdapter {abi}") != ADAPTER_PATH:
            fail(f"provenance {abi} ownershipAdapter path mismatch")
        if require_hash(adapter, "sha256", f"provenance.ownershipAdapter {abi}") != adapter_hash:
            fail(f"provenance {abi} ownershipAdapter SHA-256 mismatch")
        patched = require_object(adapter, "patchedSource", f"provenance.ownershipAdapter {abi}")
        if require(patched, "path", f"provenance.ownershipAdapter.patchedSource {abi}") != PATCHED_SOURCE_PATH:
            fail(f"provenance {abi} patchedSource path mismatch")
        if require_hash(patched, "sha256", f"provenance.ownershipAdapter.patchedSource {abi}") != patched_source_hash:
            fail(f"provenance {abi} patchedSource SHA-256 mismatch")
        dns_resolver = require_object(record, "dnsResolver", f"provenance {abi}")
        if require(dns_resolver, "path", f"provenance.dnsResolver {abi}") != DNS_RESOLVER_PATH:
            fail(f"provenance {abi} dnsResolver path mismatch")
        if require_hash(dns_resolver, "sha256", f"provenance.dnsResolver {abi}") != dns_resolver_hash:
            fail(f"provenance {abi} dnsResolver SHA-256 mismatch")
        dns_server = require_object(record, "dnsServer", f"provenance {abi}")
        if require(dns_server, "path", f"provenance.dnsServer {abi}") != DNS_SERVER_PATH:
            fail(f"provenance {abi} dnsServer path mismatch")
        if require_hash(dns_server, "sha256", f"provenance.dnsServer {abi}") != dns_server_hash:
            fail(f"provenance {abi} dnsServer SHA-256 mismatch")
        dns_doh = require_object(record, "dnsDoH", f"provenance {abi}")
        if require(dns_doh, "path", f"provenance.dnsDoH {abi}") != DNS_DOH_PATH:
            fail(f"provenance {abi} dnsDoH path mismatch")
        if require_hash(dns_doh, "sha256", f"provenance.dnsDoH {abi}") != dns_doh_hash:
            fail(f"provenance {abi} dnsDoH SHA-256 mismatch")
        for name, relative, expected in (("dnsClient", DNS_CLIENT_PATH, dns_client_hash), ("dnsTLS", DNS_TLS_PATH, dns_tls_hash), ("dnsDHCP", DNS_DHCP_PATH, dns_dhcp_hash), ("dnsUtil", DNS_UTIL_PATH, dns_util_hash), ("dhcpDiscovery", DHCP_DISCOVERY_PATH, dhcp_discovery_hash), ("ntpService", NTP_SERVICE_PATH, ntp_service_hash), ("socks5Association", SOCKS5_ASSOCIATION_PATH, socks5_hash), ("dnsOutbound", DNS_OUTBOUND_PATH, dns_outbound_hash)):
            evidence = require_object(record, name, f"provenance {abi}")
            if require(evidence, "path", f"provenance.{name} {abi}") != relative:
                fail(f"provenance {abi} {name} path mismatch")
            if require_hash(evidence, "sha256", f"provenance.{name} {abi}") != expected:
                fail(f"provenance {abi} {name} SHA-256 mismatch")
        dhcp_discovery = require_object(record, "dhcpDiscovery", f"provenance {abi}")
        if require(dhcp_discovery, "path", f"provenance.dhcpDiscovery {abi}") != DHCP_DISCOVERY_PATH:
            fail(f"provenance {abi} dhcpDiscovery path mismatch")
        if require_hash(dhcp_discovery, "sha256", f"provenance.dhcpDiscovery {abi}") != dhcp_discovery_hash:
            fail(f"provenance {abi} dhcpDiscovery SHA-256 mismatch")
        provider_fetcher = require_object(record, "providerFetcher", f"provenance {abi}")
        if require(provider_fetcher, "path", f"provenance.providerFetcher {abi}") != PROVIDER_FETCHER_PATH:
            fail(f"provenance {abi} providerFetcher path mismatch")
        if require_hash(provider_fetcher, "sha256", f"provenance.providerFetcher {abi}") != provider_fetcher_hash:
            fail(f"provenance {abi} providerFetcher SHA-256 mismatch")
        statistics = require_object(record, "statisticsPatch", f"provenance {abi}")
        if require(statistics, "path", f"provenance.statisticsPatch {abi}") != STATISTICS_PATCH_PATH:
            fail(f"provenance {abi} statisticsPatch path mismatch")
        if require_hash(statistics, "sha256", f"provenance.statisticsPatch {abi}") != statistics_patch_hash:
            fail(f"provenance {abi} statisticsPatch SHA-256 mismatch")
        patched_statistics = require_object(statistics, "patchedSource", f"provenance.statisticsPatch {abi}")
        if require(patched_statistics, "path", f"provenance.statisticsPatch.patchedSource {abi}") != PATCHED_STATISTICS_PATH:
            fail(f"provenance {abi} statistics patchedSource path mismatch")
        if require_hash(patched_statistics, "sha256", f"provenance.statisticsPatch.patchedSource {abi}") != late_manager_hash:
            fail(f"provenance {abi} statistics patchedSource SHA-256 mismatch")
        late = require_object(record, "lateConnectionsPatch", f"provenance {abi}")
        if require(late, "path", f"provenance.lateConnectionsPatch {abi}") != LATE_CONNECTIONS_PATCH_PATH:
            fail(f"provenance {abi} lateConnectionsPatch path mismatch")
        if require_hash(late, "sha256", f"provenance.lateConnectionsPatch {abi}") != late_patch_hash:
            fail(f"provenance {abi} late connections patch SHA-256 mismatch")
        sources = require_object(late, "patchedSources", f"provenance.lateConnectionsPatch {abi}")
        for name, relative, expected in (("manager", PATCHED_STATISTICS_PATH, late_manager_hash), ("tracker", PATCHED_TRACKER_PATH, tracker_hash), ("tunnel", PATCHED_TUNNEL_PATH, tunnel_hash), ("natTable", PATCHED_NAT_TABLE_PATH, nat_table_hash), ("connection", PATCHED_CONNECTION_PATH, connection_hash), ("quicSniffer", PATCHED_QUIC_SNIFFER_PATH, quic_sniffer_hash), ("tproxyPacket", PATCHED_TPROXY_PACKET_PATH, tproxy_packet_hash), ("dnsDoH", DNS_DOH_PATH, dns_doh_hash), ("dnsClient", DNS_CLIENT_PATH, dns_client_hash), ("dnsTLS", DNS_TLS_PATH, dns_tls_hash), ("dnsDHCP", DNS_DHCP_PATH, dns_dhcp_hash), ("dnsUtil", DNS_UTIL_PATH, dns_util_hash), ("dhcpDiscovery", DHCP_DISCOVERY_PATH, dhcp_discovery_hash), ("ntpService", NTP_SERVICE_PATH, ntp_service_hash), ("socks5Association", SOCKS5_ASSOCIATION_PATH, socks5_hash), ("dnsOutbound", DNS_OUTBOUND_PATH, dns_outbound_hash)):
            evidence = require_object(sources, name, f"provenance.lateConnectionsPatch.patchedSources {abi}")
            if require(evidence, "path", f"provenance late source {name} {abi}") != relative:
                fail(f"provenance {abi} lateConnectionsPatch {name} path mismatch")
            expected_digest = require_hash(evidence, "sha256", f"provenance late source {name} {abi}")
            if expected_digest != expected:
                fail(f"provenance {abi} lateConnectionsPatch {name} SHA-256 mismatch")
        # Upstream lives only in the native build job, not this application
        # checkout. Compare its recorded output to the reviewed adapter
        # constants; the artifact hash remains independently pinned below.
        log_source = require_object(record, "logSource", f"provenance {abi}")
        if require(log_source, "path", f"provenance.logSource {abi}") != LOG_PATH:
            fail(f"provenance {abi} logSource path mismatch")
        if require_hash(log_source, "sha256", f"provenance.logSource {abi}") != log_hash:
            fail(f"provenance {abi} logSource SHA-256 mismatch")
        for name, relative, expected_hash in (("providerHealthCheck", PROVIDER_HEALTHCHECK_PATH, provider_healthcheck_hash), ("proxyProvider", PROXY_PROVIDER_PATH, proxy_provider_hash)):
            evidence = require_object(record, name, f"provenance {abi}")
            if require(evidence, "path", f"provenance.{name} {abi}") != relative:
                fail(f"provenance {abi} {name} path mismatch")
            if require_hash(evidence, "sha256", f"provenance.{name} {abi}") != expected_hash:
                fail(f"provenance {abi} {name} SHA-256 mismatch")
            checkout_source = repo / relative
            if checkout_source.exists() and sha256(checkout_source) != expected_hash:
                fail(f"provenance {abi} {name} SHA-256 mismatch: checkout source differs")
        log_checkout = repo / LOG_PATH
        if log_checkout.exists() and sha256(log_checkout) != log_hash:
            fail(f"provenance {abi} logSource SHA-256 mismatch: checkout source differs")
        partifact = require_object(record, "artifact", f"provenance {abi}")
        if require(partifact, "name", f"provenance.artifact {abi}") != artifact.name:
            fail(f"provenance {abi} artifact name mismatch")
        if require_hash(partifact, "sha256", f"provenance.artifact {abi}") != actual_hash:
            fail(f"provenance {abi} artifact SHA-256 mismatch")
        doc = require(documented, abi, "compliance.artifacts")
        if require(doc, "file", f"compliance artifact {abi}") != "libclash.so":
            fail(f"compliance artifact {abi} filename mismatch")
        if require_hash(doc, "sha256", f"compliance artifact {abi}") != actual_hash:
            fail(f"compliance artifact {abi} SHA-256 mismatch")
        toolchain = require_object(record, "toolchain", f"provenance {abi}")
        for key, expected in EXPECTED_TOOLCHAIN.items():
            if require(toolchain, key, f"provenance.toolchain {abi}") != expected:
                fail(f"provenance {abi} toolchain {key} mismatch")
        expected_arch = EXPECTED_GOARCH[abi]
        if require(toolchain, "goarch", f"provenance.toolchain {abi}") != expected_arch:
            fail(f"provenance {abi} toolchain goarch mismatch")
        expected_goarm = "7" if expected_arch == "arm" else None
        if require(toolchain, "goarm", f"provenance.toolchain {abi}") != expected_goarm:
            fail(f"provenance {abi} toolchain goarm mismatch")
        build = require_object(record, "build", f"provenance {abi}")
        if require(build, "trimpath", f"provenance.build {abi}") is not True or require(build, "buildmode", f"provenance.build {abi}") != EXPECTED_BUILDMODE:
            fail(f"provenance {abi} build mode/trimpath mismatch")
        if require(build, "package", f"provenance.build {abi}") != EXPECTED_PACKAGE:
            fail(f"provenance {abi} library package mismatch")
        tags = require(build, "tags", f"provenance {abi}")
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            fail(f"provenance {abi} build tags must be a list of strings")
        if set(tags) != EXPECTED_BUILD_TAGS:
            fail(f"provenance {abi} build tags mismatch")
        if require(build, "versionLdflag", f"provenance.build {abi}") != EXPECTED_VERSION_LDFLAG:
            fail(f"provenance {abi} version ldflag mismatch")
        for name, relative in (("bridge", "native/android/mihomo-bridge/bridge.go"), ("lifecycle", "native/android/mihomo-bridge/lifecycle.go"), ("libraryEntry", "native/android/mihomo-bridge/library.go")):
            evidence = require_object(record, name, f"provenance {abi}")
            if require(evidence, "path", f"provenance.{name} {abi}") != relative:
                fail(f"provenance {abi} {name} path mismatch")
            expected_digest = require_hash(evidence, "sha256", f"provenance.{name} {abi}")
            actual_digest = sha256(repo / relative)
            if actual_digest != expected_digest:
                fail(f"provenance {abi} {name} source digest mismatch: checkout {actual_digest}, provenance {expected_digest}")
    print(f"Mihomo native artifacts verified: {', '.join(ABIS)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-root", required=True, type=Path)
    parser.add_argument("--repo-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        verify(args.artifacts_root.resolve(), args.repo_root.resolve())
    except VerificationError as exc:
        print(f"Mihomo artifact verification FAILED: {exc}", file=sys.stderr)
        return 1
    except (AttributeError, TypeError, ValueError) as exc:
        print(f"Mihomo artifact verification FAILED: invalid data structure: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
