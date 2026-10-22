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

## Android default mixed TCP stop boundary

The default `mixed-port` TCP listener is created by `ApplyConfig`, separately
from the Android TUN. Its accept loop and connections waiting for a first byte
or an incomplete HTTP/SOCKS handshake do not enter the tunnel tracker snapshot.
Explicit Android stop now closes every retained default mixed TCP generation,
then joins its accept/handler exits under one shared two-second deadline. A
handler may still be inside a synchronous tunnel call; its generation remains
owned if that call has not returned. Connection-close failures, including a late
Accept result, and missing listener-close acknowledgements remain concrete retry
responsibilities even when the handler itself has exited. Only a pure wrapped
or joined `net.ErrClosed` counts as an already-released socket.

A separate mixed-cleanup debt blocks apply, DNS update and TUN attachment until
an explicit stop retry succeeds. A successful TUN/DNS/NTP/provider cleanup does
not erase it. Attachment replacement does not cancel newly applied mixed ingress.
After successful stop, reapplying the same TCP port creates a fresh listener
without replacing or losing ownership of an existing mixed UDP listener.

The host tests use the actual bridge, real TCP peers, controlled late Accept and
Close failures, and race detection. Five actual-bridge negative mutations run
three times each and must fail at their designated ownership/gate assertions,
not at a build error, race report or unrelated timeout. The reviewed three-file
`mixed-lifecycle.patch`, its exact pristine/output hashes, and all three new
source records are mandatory ABI provenance evidence. Existing pins and gates
remain enforced.

This is deliberately limited to **default mixed-port TCP accept/handler work**.
Named mixed inbounds, mixed UDP, other inbound protocols, asynchronously dispatched
tunnel work, complete kernel shutdown, overall recovery and Android/JNI real-device
acceptance are not established by this repair. The deadline bounds joining these
workers, not arbitrary implementation-defined `Close` calls or total stop time.

## Android named mixed inbound stop boundary

Named `listeners: [{type: mixed, ...}]` are distinct from the default
`mixed-port` registry. Explicit Android stop also retains each named mixed
instance from the beginning of `Listen`, including partially created and retired
instances, closes its sockets, and joins its TCP accept loop and synchronous
first-byte/HTTP/SOCKS handshake handlers under a separate shared deadline.
Failed close acknowledgements and handler timeouts retain that concrete generation
for a later stop retry. Independent named-cleanup debt blocks apply, DNS updates
and TUN attachment; successful cleanup of another component cannot erase it.
Attachment replacement itself does not close freshly applied named listeners.

A stopped named mixed instance is not reused merely because its configuration is
equal. Reload/removal must retain a failed-close owner, and explicit stop can
still reach generations no longer present in the current listener map. The
`named-inbound-lifecycle.patch`, exact pristine/intermediate/final digests and
named source records are mandatory provenance evidence alongside the reviewed
default mixed adapter and upstream pins. Actual-bridge race tests cover idle and
half-handshake peers, same-configuration rebuild, failed-close retry gates and a
handler whose exit remains blocked after its socket closes. Mutation controls
must fail at the designated ownership/gate assertion, never merely fail to build.
The bridge listener fixture uses an explicit named authentication store so the
test isolates resource ownership from existing mutable default authentication/IP
filter globals during apply. Synchronizing those globals is not part of this fix.

This is **named mixed TCP/UDP ingress cleanup**, not a generic inbound shutdown.
Named mixed UDP uses the owned packet adapter without registering in the default
mixed-port UDP registry. Its containing named `Mixed` generation joins the UDP
reader (including its synchronous tunnel callback), retained packets until
`Drop`, and admitted write-backs until method exit. Closing the socket alone
cannot acknowledge any of these. A timeout retains the whole named generation
and its independent named-cleanup debt for a later explicit stop retry. Payload
buffers are not forcibly reclaimed while retained; malformed and late packets
are returned, and `Drop` acknowledges a valid packet exactly once. Retired packets
cannot initiate a new write-back after close. Ordinary named SOCKS UDP is not
silently enrolled in either mixed registry.

Actual-bridge race regressions cover held packets, dropped-but-blocked handlers,
write-backs, close-acknowledgement failures, default/named registry isolation,
and real named UDP tunnel round-trips over same-configuration stop/restart.
Eighteen UDP-specific negative controls reject the old unowned constructor,
wrong registry membership, forgotten generations and each missing packet/write-back/reader join.
The exact reviewed UDP and named source hashes remain mandatory ABI provenance.
The deadline bounds exit waiting, not arbitrary synchronous `Close` calls.
Other named inbound protocols, asynchronous tunnel
work, arbitrary blocking `Close` implementations, complete kernel shutdown and
Android/JNI real-device acceptance remain outside this boundary. No packaged
library hash, licensing approval or release gate is relaxed by the repair.
