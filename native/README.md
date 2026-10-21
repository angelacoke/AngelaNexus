# AngelaNexus native platform layer

This directory contains real OS-facing transport boundaries. It is separate from
the platform-neutral JavaScript core.

## Native boundaries

- Android: VPN service and TUN lifecycle.
- iOS/macOS: Network Extension packet-tunnel lifecycle.
- Windows: dynamic Wintun DLL loading boundary.
- Linux: /dev/net/tun creation boundary.

## Scope

These files do not claim complete production VPN integration. They establish the
native OS boundary without silently selecting routing, DNS, kernel, node, chain,
or security policy.

The next integration layer must connect these boundaries to the selected
Mihomo, sing-box, or Xray adapter and verify them on each target OS.

## Security rule

No native implementation may silently fall back to direct networking when the
selected proxy runtime fails. Fail-closed behavior belongs to the application
security/policy layer and must remain explicit and testable.

## Android provider stop boundary

Explicit Android stop cancels all retained provider generations before waiting
for any of them. Compatible and inline providers join their health checks;
proxy-set providers join both the Fetcher and health checks under the same
shared two-second drain deadline. Admission is registered before asynchronous
startup, repeated startup is idempotent, and closed providers cannot restart a
health check. Configuration snapshots are synchronized without holding their
lock across proxy URLTest calls. Close remains non-blocking for reentrant
callbacks; WaitClosed is the exit barrier.
Already-admitted work may finish after Close, but must finish before a
successful WaitClosed return.

A timed-out or failed drain retains ownership and blocks reconfiguration or
attachment until a later stop successfully retries cleanup. The deadline bounds
provider drain, not each Close call or the entire stop operation. This is not
complete kernel shutdown: DNS listeners/services, all other background workers,
synchronous reload cleanup, new native library packaging, and real-device TUN,
leak and battery acceptance remain separate work.

The upstream commit and dependency pins are unchanged. Both
`adapter/provider/healthcheck.go` and `adapter/provider/provider.go` have exact
pristine and reviewed-output SHA-256 checks in `prepare-upstream.py`. The patch
requires twelve exact sections, and each ABI provenance must include matching
`providerHealthCheck` and `proxyProvider` paths/hashes in addition to all existing
source and artifact gates. Unknown, missing or modified inputs fail closed.

## Android resource-stop retry gate

A failed explicit Mihomo stop also retains an independent retry gate for TUN
listener Close, tracked-connection Close, admitted setup drain, and late setup
connections. Fresh configuration, DNS reconfiguration and TUN attachment reject
before parsing or replacement cleanup until an explicit stop retry acknowledges
that resource cleanup. Success in provider, DNS or NTP teardown cannot clear this
gate; conversely resource cleanup cannot clear another component's failed drain.
The original joined stop errors and retained resource owners remain available to
the existing JNI/Kotlin failure-and-retry path.

The pinned-source host tests exercise the real bridge bodies under the race
detector, including a deferred request whose stop-generation token is still
current, mixed closed/error causes, setup timeout, descriptor preservation and
independent component retries. Nine negative controls remove only one of the
three entry gates at a time and must fail at its specific assertion. They do not
prove bounded Close calls, complete kernel shutdown, overall recovery, or Android
TUN/JNI device acceptance. Upstream/dependency pins and source/hash/provenance
gates are unchanged.
