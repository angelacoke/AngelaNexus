# Android Native Runtime Integration Baseline

Status: native build and lifecycle regression coverage exist; current bridge packaging, physical-device runtime validation and distribution approval are separate, incomplete gates.

## Pinned upstream and historical artifact contract

- Mihomo version: v1.19.32
- Upstream revision pinned by CI: `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`
- Historical arm64-v8a `libclash.so` SHA-256: `667c94964d0a60f86cdcc130b2cdf3b385b02d9f2c5d3b324b3ed7a6b7326007`
- Historical armeabi-v7a `libclash.so` SHA-256: `3ae94d7defb1778cd611eceffcff6884407893d28c42a4350af2b49108ac9a09`
- Historical x86_64 `libclash.so` SHA-256: `da7bcdbf165cc1e3457d3560b51e703cb3a478dd83f0c1cfe42ccf676d6c1f42`

These values remain pinned in the Kotlin runtime manifest and compliance record. They are not evidence that the latest bridge sources have been packaged. Changing bridge/lifecycle code requires a new native build, review of its exact artifacts and an explicit update of the pinned contract before those artifacts can be loaded. CI must not silently rewrite runtime hashes to accept whatever it downloaded.

## Integration boundary

AngelaNexus owns lifecycle, configuration transport, VPN/TUN ownership, security policy, ABI validation and runtime status. Mihomo owns packet processing and native networking operations. Configuration parsing and kernel selection remain in AngelaNexus Core; the bridge must not duplicate them.

The Android integration requires no implicit runtime fallback, no loading of unverified artifacts, and no native capability claims before the corresponding real smoke test succeeds. New JNI consumers require the error-returning `angelaStopTun` export; an older library without it fails explicitly rather than reporting a successful stop.

## What TUN stop actually guarantees

The bridge serializes configuration, TUN lifecycle and explicit suspend/resume. Stop first suspends tunnel admission, closes the socket-protection gate, waits for already-entered protection callbacks to return, and closes the bridge-owned TUN listener. A failed listener close retains ownership for retry; the protection gate stays closed. Configuration cannot restore readiness inferred merely from a retained listener, and explicit resume cannot reopen an unattached or failed-stop runtime.

After the listener close attempt, stop snapshots the pinned upstream's `statistic.DefaultManager` and attempts to close every visible TCP/UDP tracker, even when the listener close failed. Listener and connection errors are combined and reach JNI's existing failed-stop path. Upstream trackers unregister before their underlying socket close returns, including on failure, so the bridge retains failed tracker ownership independently and retries it on the next stop or replacement start. Successful cleanup entries are removed rather than closed again by an empty repeated stop. Configuration updates do not sweep active connections.

A captured socket may already have been closed by a concurrent upstream worker. A close error consisting only of the standard `net.ErrClosed` (including wrapped/joined closed-only errors) counts as released rather than becoming a permanently failing retry. A joined error containing any unrelated failure remains pending and is reported; an empty tracker list alone is never used as proof of socket closure.

The admission read lock spans only the socket protection callback. Stop/configuration do not hold the write lock while invoking upstream cleanup/configuration, which may itself invoke the hook. Stop waits for an in-progress `VpnService.protect` call; this is not a timed cancellation mechanism and does not promise a fixed shutdown deadline.

Each socket hook samples an admission epoch before checking readiness or waiting for the read lock. Every stop/configuration drain invalidates the previous epoch before acquiring the write lock. A hook paused before acquiring its read lock cannot borrow a later reopened `protected=true` state after configuration or replacement; it is rejected before touching the socket or invoking protection. This protects hook admission only, not a dial that has already returned successfully from the hook. Epoch tokens do not tag upstream tracker registrations or cancel ongoing connects.

The same closed-only error rule also applies to the TUN listener: `net.ErrClosed`, including wrapped/joined closed-only errors, releases its retained ownership. Any mixed real failure still reaches the retry path. This does not classify arbitrary close errors or error strings as successful cleanup.

Configuration parsing is part of the lifecycle critical section, not a read-only preparation step. At the pinned upstream revision, `config.Parse` temporarily changes global settings and later rolls them back; parsing outside the mutex can race another apply/DNS update or restore stale settings after it. The exported configuration body now holds `androidTunMu` through parse, apply and saved-JSON commit. Home-directory initialization takes the same lock, as do DNS reconfiguration and stop/start. Parse rejection does not replace the saved configuration. This serializes bridge control calls only: it neither synchronizes every upstream background reader nor cancels an in-progress parse, and stop can wait for parsing/application to return.

**This is not full Mihomo shutdown.** A connection whose socket hook returned before stop may still finish dialing or register a tracker after the snapshot. Only trackers visible during the manager range and previously retained failures are covered; unregistered connections, NAT state, provider health checks/fetchers, DNS listeners, statistic tickers and other upstream goroutines are not all closed by this contract. The snapshot is not a registration barrier or a guarantee that every connection present at stop entry was observed. At the pinned revision, `executor.Shutdown()` is also not a complete connection/task termination API, so calling it would not establish that guarantee. A successful TUN stop must not be presented as proof of zero remaining sockets, background work or battery use. Individual upstream close operations have no new timeout.

A replacement TUN start attempts the same listener/tracker cleanup before validating all new arguments; any cleanup failure prevents constructing the new TUN and retains the caller's descriptor. Even an invalid replacement therefore closes captured old connections and can leave the runtime stopped. Only a successful new TUN construction reopens protection and resumes admission.

## What the tests establish

- Go helper tests with the race detector exercise protection rejection, callback draining during stop/configuration, panic-safe lock release, close failure/retry, joined connection errors, duplicate-ID ownership and idempotence.
- A host cgo test against the pinned upstream source exercises actual `executor.ApplyConfig` and tunnel status transitions. It also registers real loopback TCP/UDP sockets with upstream trackers, carries data before stop/replacement, and checks underlying socket closure (including peer EOF), not merely an empty manager. An injected underlying close failure proves retry survives upstream unregistration and a simultaneous listener failure. Only the Android build constraint is removed from the bridge; the whole dedicated library package is tested, while importing the real upstream core packages. CI restores the original bridge before NDK compilation. Loopback sockets are deliberately created with Go's `net` package, not the protected dialer. This is not Android SDK, TUN, VPN protection, full routing or full-core shutdown evidence.
- Package integration tests reject upstream CLI flags and invoke the installed socket hook, including the actual cgo fail-closed path when no host VpnService symbol exists. A separate host `c-shared` build is loaded through `ctypes` with foreign host arguments; it exercises C result ownership, initialization, invalid/valid configuration, invalid TUN start, repeated stop and reconfiguration. The process has a 30-second outer timeout. This proves host ABI callability, not valid Android TUN attachment or process-wide quiescence.
- Concurrent host regressions call the same bodies as the C exports for apply, DNS update, home initialization and stop; they verify saved/upstream mode agreement and that an unattached runtime stays suspended. Rejected configurations preserve committed state. Restoring the old parse-outside-lock boundary produces actual race-detector failures. The real `ctypes` smoke also calls those four C exports from multiple host threads with result ownership checks; this does not establish thread safety for all upstream background tasks.
- Three-ABI NDK builds check every required exported symbol and record artifact, bridge, lifecycle and library-entry SHA-256 provenance plus the dedicated build package.
- Ordinary `android-build` prepares Xray/sing-box AARs. Passing that workflow alone does not prove it included the latest Mihomo `.so` or executed `angelaStopTun`.

## Dedicated shared-library entry

Native builds and host package tests now stage the same `bridge.go`, `lifecycle.go` and minimal `library.go` in `./angelanexus_android` inside the fixed upstream module. The shared library no longer builds the upstream module root: its CLI `main.go` registers and parses process arguments in `init()`, an inappropriate side effect for an embedded runtime. The dedicated `main()` is empty; runtime startup remains explicit through the bridge exports. Imported core package initialization is unchanged and can still create upstream background tasks.

This replaces the earlier mismatch where host tests excluded CLI startup with an explicit file list but NDK builds still compiled the module root. Neither tests nor native builds rewrite upstream source or advance its pinned revision. Provenance must identify `build.package=./angelanexus_android` and the exact library-entry digest. The packaging verifier rejects absent/mismatched package or entry evidence, so historical root-package builds cannot silently satisfy the new contract. Runtime hashes and distribution approvals still require separate review; this change does not authorize packaging a new library.

## Packaging and distribution gates

The dedicated `android-native-package` workflow is separate and follows native builds on `main`. Its distribution gate currently remains blocked pending license, provenance and naming review; do not bypass it to obtain a green build. The application is Apache-2.0 and the embedded Mihomo artifact is declared GPL-3.0, requiring an approved distribution model.

Before copying any library, the packaging verifier must check all three ABI artifacts and provenance against the checked-out bridge/lifecycle/library-entry source and both the Kotlin and compliance hash contracts. Missing, mixed, tampered or unreviewed artifacts fail closed. Hash/provenance checks are consistency checks, not a replacement for trusted build provenance or legal approval.

Release evidence still requires exact upstream and bridge revisions, toolchain versions, ABI inventory, every shipped artifact hash, licenses/notices, packaged APK/AAB verification and signing-certificate verification. No prebuilt external AAR or native library is an implicit production dependency.

Physical-device validation remains required: load -> initialize -> apply configuration -> TUN start -> TCP/UDP/DNS/IPv6 traffic -> stop/retry -> restart, including leak and battery/background measurements. Neither native compilation nor launcher stability establishes those results. The runtime is not end-to-end production-ready.
