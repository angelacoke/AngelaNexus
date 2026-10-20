# AngelaNexus APP Progress

## Product scope

AngelaNexus APP is a full-platform product from the architecture baseline:

- Android
- iOS
- Windows
- macOS
- Linux

Android is currently the first platform with an executable application shell. It is not the architectural primary platform.

See `docs/APP_PLATFORM_STRATEGY.md` for the cross-platform application architecture and capability boundaries.

## Verified Android baseline

The repository contains a real Android application module in addition to the platform-neutral core and native VPN boundary.

### Android 0.1.0 application shell

Implemented:

- Gradle Android application module under `native/android/app`.
- `app.angelanexus` application namespace and package.
- Launcher `MainActivity`.
- AngelaNexus brand mark used by the application UI and launcher icon.
- Native Android `VpnService` boundary wired into the application manifest.
- Android document picker entry point for configuration import.
- Explicit runtime status indicating that kernel execution is not yet connected.
- Dedicated Android debug-build CI workflow.

### Android configuration import path

Implemented and tested:

- bounded UTF-8 reading with the 5 MiB input limit;
- versioned Android import DTO and serialized envelope;
- Android transport boundary that sends only the serialized envelope;
- platform-neutral runtime receiver that validates envelope type, version, source, name and byte limit;
- Core import runtime handoff into the existing kernel-neutral import pipeline;
- regression coverage for valid envelopes and malformed/oversized input.

This milestone establishes the import path contract. It does **not** claim that a kernel has already started from the imported configuration.

### Android transparent/root networking baseline

Implemented and tested at the contract/integration level:

- transparent mode selection;
- guarded rooted backend capability checks;
- atomic rule transaction boundaries;
- self-loop protection;
- cleanup and rollback handling;
- live transparent runtime inspection and health checks.

Real-device traffic interception remains a separate verification requirement and is not marked complete without reproducible device evidence.

### Android execution-state bridge

Implemented in source with regression coverage:

- stable kernel-neutral execution phases from import receipt through start, running, stop and failure;
- platform control-plane state object carrying the selected kernel identifier and failure detail;
- listener-based state publication for UI/runtime integration;
- explicit rejection of blank kernel identifiers and failure details.

This is an executable control-plane milestone. It does **not** claim that a Mihomo/sing-box/Xray runtime is already embedded or running.

### Android Mihomo native runtime boundary

Implemented and CI-verified:

- Mihomo source pinned to exact release `v1.19.32` commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`;
- Android native shared-library build verification for `arm64-v8a`, `armeabi-v7a` and `x86_64`;
- Go 1.24.8 and Android NDK 28.0.13004108 pinned in the verification workflow;
- reproducible `c-shared` build with version metadata pinned to `v1.19.32`;
- SHA-256-pinned native artifacts for all three supported ABIs;
- verified JNI loading boundary that refuses missing or hash-mismatched native artifacts;
- dedicated Android packaging workflow that downloads only the verified artifacts, packages `libclash.so` plus the AngelaNexus JNI shim, and verifies the final APK contents and hashes;
- signed Mihomo-enabled APK/AAB artifact successfully produced by CI.

The native core is now actually present in the dedicated Mihomo-enabled Android release artifact. This does **not** claim successful end-to-end TUN traffic on a physical Android device.

### Modern modular UI baseline

Implemented on Android as the first platform surface:

- Jetpack Compose + Material 3 foundation.
- System light/dark theme support and Android dynamic colors.
- Five-module navigation: Home / Profiles / Proxies / Rules / Settings.
- Compact card-based dashboard with AngelaNexus-specific information architecture.
- Explicit Core, VPN, routing, anti-leak and GFW status surfaces.
- Responsive semantic component structure intended for phone/tablet/desktop adaptation.
- UI design specification in `docs/APP_UI_DESIGN.md`.

The long-term UI implementation will move common semantics and reusable UI into the shared multiplatform layer. Android-only APIs remain in the Android shell.

## Account / cloud / backup baseline

Implemented at the Core contract level:

- shared account-data classification;
- platform-state separation;
- device-only secret exclusion;
- account snapshot model;
- snapshot merge contract;
- backup manifest format/version contract;
- backup validation that rejects device credentials/secrets;
- regression tests covering these boundaries;
- full UI/architecture specifications in `docs/APP_ACCOUNT_SYNC.md`.

This is a data-contract milestone, **not** a claim that the cloud account service or production cloud storage is already deployed.

## Windows / macOS / iOS platform bridge baseline (contract level)

Implemented and tested at the Core contract level, following the established Android/Linux bridge pattern:

- Windows capability registry (`wintun-tun`, `wfp`, `elevated-install`, `system-proxy`, `process-exclusion`, `dns-observation`), grounded in `native/windows/AngelaNexusTun.cpp` (wintun driver loading) and `docs/PLATFORM_ARCHITECTURE.md` (WFP/TUN integration, elevated installation/service capabilities);
- Windows wintun TUN path adapter syncing probe evidence into the capability and path registries with fail-closed admission: unverified probes quarantine the path, and required elevation or process-exclusion without evidence blocks admission instead of silently widening scope;
- macOS capability registry (`packet-tunnel`, `system-extension`, `app-proxy`, `pf-transparent`, `elevated`, `process-exclusion`, `dns-observation`) and packet-tunnel path adapter with the same fail-closed contract, grounded in `native/apple/AngelaNexusPacketTunnelProvider.swift`;
- iOS capability registry (`packet-tunnel`, `app-proxy`, `dns-observation`) with documented platform constraints (no root assumption, no privileged transparent proxying outside NetworkExtension, default route requires explicit user policy) and packet-tunnel path adapter;
- all six modules exported from `src/platform/index.js`;
- 39 new regression tests covering registry semantics, probe verification, quarantine on unverified probes, fail-closed process-exclusion/elevation handling, and explicit user denial.

This milestone completes the contract-level bridge for all five target platforms (Android/Linux existed; Windows/macOS/iOS are new). It does **not** claim native probing on real devices, driver installation, or production readiness.

## Not yet claimed as production functionality

- The standard Android shell release is not yet the final Mihomo-enabled production release; the dedicated Mihomo-enabled release artifact is the current verified native packaging path.
- The imported configuration IS compiled by Core (import-pipeline with prepareRuntimeHandoff), bound to the selected kernel (binding.kernel), and launched through the Android VPN lifecycle (MainActivity → AngelaNexusVpnService → AndroidKernelDriver). What remains is physical-device verification of the end-to-end path.
- Physical-device TUN establishment and end-to-end proxy traffic interception are not yet verified evidence.
- The UI is not yet backed by the complete Core execution state stream.
- No production Android background lifecycle, notification channel, secure storage, or battery policy integration is claimed yet.
- Production cloud authentication/storage/sync service is not yet implemented.
- iOS, Windows, macOS and Linux executable application shells are not yet claimed as implemented.

## Cross-platform APP milestones

1. Establish shared UI/state contracts across all target platforms.
2. Establish account/sync/backup contracts and security boundaries. **Done at Core contract level.**
3. Extract reusable UI into the multiplatform UI layer without leaking platform APIs.
4. Implement account authentication and cloud data service behind a platform-neutral service contract.
5. Connect Android configuration import to the kernel-neutral import pipeline. **Done at contract + automated-test level.**
6. Complete Android execution-state bridge and one verified kernel runtime. **Execution-state bridge implemented; Mihomo v1.19.32 native build, hash verification, JNI packaging and signed APK/AAB packaging are verified; physical-device runtime/traffic verification remains.**
7. Establish Desktop JVM application shell shared by Windows/macOS/Linux.
8. Establish iOS application entry point and Network Extension boundary.
9. Add platform-specific secure storage, background lifecycle, notifications, network state and resource-policy adapters.
10. Integrate Mihomo/sing-box/Xray per platform only after adapter-level verification.
11. Add device/OS regression verification and release packaging for every target.

## Evidence rule

A milestone is marked implemented only after source-level evidence plus reproducible build/test evidence exists. Platform placeholders remain explicitly labeled until exercised.

## Import and startup reliability

Implemented with regression coverage:

- Share-link imports preserve VLESS UUIDs, Trojan passwords, VMess JSON payloads, Shadowsocks methods/passwords, TLS options and transport settings through the canonical model.
- Both plaintext and Base64 subscriptions are supported, with one decoding layer only. Structured documents take precedence over links appearing in their metadata.
- Text, local-file, URL and structured `importSource` entry points forward an explicitly requested runtime handoff; compilation alone does not start a runtime.
- The Android Core bundle supports UTF-8/Base64 buffer conversion, with tests executing the generated bundle without Node's Buffer global.
- A resolved Android import publishes IMPORT_RECEIVED → RESOLVING → READY before a later VPN start; invalid imports/lifecycle changes remain inside the UI error handler. Ready profiles can be replaced before starting, but running profiles cannot bypass the stop lifecycle.
- The development HTTP import endpoint rejects lookalike media types and oversized declared/chunked bodies. It remains a local development interface without authentication or TLS.
- Kernel baseline tests validate registry consistency rather than duplicating version literals, allowing controlled upstream candidates to reach the existing verification gates without silently changing policy.

Local verification includes the JavaScript test suite, generated Android bundle tests, pure Kotlin execution-state tests, and configuration checks against the pinned Mihomo, sing-box and Xray Linux binaries. This is not evidence of a full Android build, physical-device startup, proxy traffic, leak prevention or battery behavior. The Android build workflow and physical-device release gates remain necessary.

## Subscription download and authority hardening

Implemented with automated regression coverage:

- Share-link query extensions cannot overwrite the URI's server, port, protocol, identity, credentials, or structured TLS/transport configuration. Supported extension fields such as VLESS flow remain available; prototype-related keys are ignored.
- URL downloads have a 30-second default deadline covering redirects, headers and body reads. Both public URL import entry points forward explicit `timeoutMs`, `signal` and `maxBytes` options. Cancellation does not wait indefinitely for a non-cooperative custom fetcher or cleanup callback.
- Redirect/error bodies are cancelled, stream reader locks and abort listeners are released, declared and actual byte limits are enforced, and invalid UTF-8 bytes are rejected instead of silently changing credentials.
- The cancellation listener count is bounded by pending operations rather than the number of received chunks.

Architecture audit: these changes remain in the platform-neutral import pipeline. They do not select a different kernel, alter user routing, bypass capability checks, change the pinned upstream baseline, or claim real-device traffic/leak validation. The unauthenticated HTTP development service remains local-only in intended use; download bounds do not turn it into a production API.

The text-only custom-fetcher compatibility path is **not** a hard streaming memory boundary: `response.text()` materializes first, then the byte limit is checked. Such trusted adapters must bound their own allocation and honor cancellation; an outer deadline cannot forcibly stop arbitrary custom JavaScript. Standard Fetch responses use the bounded streaming path.

### Mihomo native protocol names

Real-process traffic testing exposed a gap that structural tests had accepted: canonical `socks` and `shadowsocks` must compile to Mihomo's native `socks5` and `ss` types. The adapter now performs this translation, and native structural validation rejects the canonical-only spellings and enforces SS cipher/password requirements. This is grounded in the official [SOCKS](https://wiki.metacubex.one/en/config/proxies/socks/) and [Shadowsocks](https://wiki.metacubex.one/en/config/proxies/ss/) configuration references, with real pinned-binary verification required alongside unit tests. The kernel-neutral protocol model and pinned versions are unchanged.

## Real loopback proxy traffic and cleanup reliability

`npm run kernel:traffic:test` runs the actual maintained Mihomo, sing-box and Xray executables against a controlled local HTTP target and SOCKS5 upstream. Set `NEXUS_MIHOMO_BIN`, `NEXUS_SING_BOX_BIN` and `NEXUS_XRAY_BIN` explicitly; the harness does not download binaries or assume a workspace/version-specific path. The normal kernel-conformance CI job now runs it after configuration validation.

For each kernel, the harness compiles a canonical routing policy, adds only a test loopback inbound, and requires independent target-response plus upstream-connection evidence. It then refuses upstream connections and verifies that the request cannot reach the target directly. Ports are dynamic and local, logs and request times are bounded, sockets/temporary files/processes are cleaned up, and no system proxy, firewall or TUN configuration is changed. This is Linux loopback TCP forwarding evidence, not Android physical-device interception, encrypted-protocol interoperability, UDP, DNS/IPv6 leak prevention or battery validation.

On Android, failed transparent-runtime health checks now clean up before releasing the handle. `stop()` can retry cleanup from `FAILED`, retaining the active transaction if cleanup fails. Regression coverage includes successful cleanup and a deliberately failed first rollback followed by a successful retry. JVM tests are not evidence that root commands ran on Android hardware.

Follow-up local evidence: all three pinned Linux processes passed both forwarding and upstream-refusal scenarios, each with one independent successful upstream connection and one HTTP target request. Mihomo's actual binary also accepted compiler-generated SOCKS5 and Shadowsocks configurations. The seven selected Android transparent/root and execution-state test classes passed 35 JUnit tests when compiled from the real repository sources, including the real adapter; only the unused `android.content.Context` type was supplied as a compile-only JVM stub. No Android platform/API behavior is simulated by that stub, and this does not replace a Gradle/SDK application build or hardware verification. Foundation DNA and inheritance checks remain mandatory and unchanged.

## Android build evidence and fail-closed launcher verification

For commit `6bc3172aaedb78fea7f57e6e9ebb67a8324013f1`, [android-build run 39373217312](https://github.com/angelacoke/AngelaNexus/actions/runs/39373217312) completed successfully: pinned native AAR preparation, Gradle Android unit tests, debug APK assembly and emulator installation/launcher smoke all passed. The push workflow also assembled and verified the production signing certificate for the release APK/AAB and uploaded [the signed build artifact](https://github.com/angelacoke/AngelaNexus/actions/runs/39373217312/artifacts/12242462519). A duplicate pull-request run was cancelled; that cancellation does not negate the successful push build for the identical commit. This evidence applies to that commit, not automatically to subsequent changes.

The launcher verifier is now shared by the build and standalone GMS-less smoke workflows. It checks explicit install/launch success, samples unchanged process identity for 30 seconds, and requires a resumed MainActivity and an installed package path. Each adb subprocess has a timeout and output bound. Install, launch, delayed process death, process restart or background-only activity failures return nonzero. The standalone workflow previously could label a crashed process while still completing successfully; it now propagates verifier failure, retains diagnostics and always attempts emulator teardown. Pull-request builds without signed release artifacts do not trigger that standalone release-artifact check. Its verifier source is checked out at the workflow revision, not at a downloaded build's source revision.

The Android build uploads the debug APK, available JUnit XML and emulator/logcat/activity diagnostics even when a later step fails. The reusable verifier's regression tests inject bounded adb responses; additional tests execute the actual standalone Bash verdict block with successful, failed and timed-out verifier commands to ensure failure cannot be swallowed by the logging pipeline. These tests do not execute an Android emulator locally.

Xray startup now scopes the received TUN descriptor until ownership transfers to the running service. Configuration, controller, DNS or native-start exceptions before transfer close the descriptor, while a successfully transferred descriptor remains owned by runtime teardown. Kotlin `use` retains the original startup error and suppresses a simultaneous close failure rather than replacing its cause. Pure Kotlin/JUnit tests exercise exception cleanup, ownership transfer, repeated close/transfer and cleanup-error handling; the full Android service change still requires the new commit's SDK/CI build.

The Linux loopback traffic verifier also requires the exact expected HTTP success status/body and request method/path rather than accepting a marker embedded in any response. Neither this check nor launcher survival is evidence of physical-device TUN, UDP, DNS/IPv6 leak prevention, encrypted upstream interoperability or battery behavior. No platform policy, kernel pin or Foundation document is changed.

### Follow-up cleanup and observation boundaries

Xray stop no longer skips a pending DNS reset after native teardown and TUN descriptor release. The cleanup gate treats any remaining native runtime, descriptor or pending DNS reset as unfinished work. Pure Kotlin regressions cover all eight gate-state combinations plus the pending-DNS-only regression; they test the gate and descriptor ownership, not Android's DNS implementation or the actual native service lifecycle.

After the observation window, launcher smoke reads the logs cleared before launch and rejects app-scoped Java/native crash or ANR records, even when the final PID is alive and MainActivity remains resumed. A log-read failure also fails the verifier. Similar-looking package names do not count as this application's crash. This remains bounded, sampled launcher verification, not a guarantee that every possible hang or device failure is detectable.

Loopback target-response validation additionally requires a single decimal Content-Length matching the exact expected body length, and rejects missing, malformed, duplicate or conflicting length fields and unexpected Transfer-Encoding. These are controlled-fixture checks, not a general-purpose HTTP parser or a production traffic security layer.

The first CI run of the log-aware verifier (`b5c3ddf`, run 39383357930) passed Android Gradle unit tests, debug assembly and signed release APK/AAB verification, but failed launcher verification with `stdout maxBuffer length exceeded`. The verifier now requests only AndroidRuntime/ActivityManager/ActivityTaskManager/DEBUG failure-priority records from the main, system and crash buffers instead of dumping noisy system-wide logs. It retains the original output bound and fails closed on filtered-log overflow; it does not truncate logs and then report success. adb failures include command context for diagnosis. The follow-up commit still needs its own full CI evidence.
## Mihomo stop ownership and bounded local uploads

The Android Mihomo bridge now blocks new socket-hook admissions by default, throughout TUN construction failures, and before TUN cleanup. Admitted sockets still require a successful `VpnService.protect` call; an unavailable protector or `RawConn.Control` failure is an error, never an implicit bypass. Configuration application temporarily blocks admission and restores only its previous admission state. Configuration, DNS updates, TUN replacement and stop share one lifecycle mutex, so a retained listener after failed cleanup cannot accidentally be interpreted as a ready runtime.

The error-returning `angelaStopTun` export preserves the listener when `Close` fails. JNI requires this export and propagates its error to the existing Kotlin failed-stop/retry path before the driver clears its attached state or protector. The old void `stopTun` export remains for ABI compatibility, but cannot report cleanup errors; new JNI deliberately does not fall back to it. Go tests execute the actual lifecycle helper, and the dedicated native workflow runs them with the race detector, copies the helper into the pinned upstream build and records its SHA-256 in provenance. Export verification now requires every listed symbol individually, including `angelaStopTun`, rather than accepting any one matching export.

Stop and replacement start additionally snapshot upstream `statistic.DefaultManager` after the listener-close attempt and close every captured TCP/UDP tracker, even if listener cleanup fails. Combined errors reach the existing failed-stop/retry path. Because pinned upstream unregisters trackers before the underlying close returns, the bridge retains failed connection ownership in a separate retry map; a later stop retries these objects even when the manager no longer lists them. Host integration regressions exercise real loopback TCP/UDP traffic, underlying socket closure and TCP peer EOF, plus an unregistered failed tracker and simultaneous listener failure.

This is **not a complete Mihomo core shutdown**: the tracker sweep is not a registration or dial-completion barrier. A previously admitted dial may complete or register after the snapshot; unregistered sockets, NAT state, providers/healthchecks/fetchers, DNS listeners and global statistic tickers are not all closed. Physical-device stop/background behavior, prevention of all post-stop traffic and battery behavior remain unverified. Newly compiled JNI requires a correspondingly rebuilt native library; older native artifacts without the new export fail closed on stop, not silently report success. Native builds and dedicated native packaging must be verified for the new revision; prior signed APKs do not prove this change.

The local development HTTP import service now applies a configurable `bodyTimeoutMs` (default 30 seconds, positive integer within Node's timer limit) to request-body reading from handler entry. Continued small chunks do not reset the deadline. Timeout cancels the body reader, returns HTTP 408 with `Connection: close`, and closes the socket after the response is flushed. Completed reads clear the timer before importer execution; this is not a deadline or cancellation guarantee for a custom importer. Real TCP regressions cover incomplete Content-Length uploads, multi-chunk drip uploads, interrupted clients and reuse of a keep-alive connection after the old deadline. This service still has no authentication/TLS and is not a production API; subscription destination and user routing policies are unchanged.

### Admission epochs and already-closed listener ownership

Socket admission now captures an epoch at hook entry. Stop/configuration invalidate that epoch before draining callbacks, so an old hook delayed before the read lock cannot borrow readiness reopened by a later configuration or runtime. A fresh hook still requires successful socket protection. Deterministic helper tests model a pause after token capture and cover configuration, stop/restart and repeated stop; host tests exercise the same rule through real pinned-upstream transitions. These are admission tests, not delayed-connect or tracker-registration barriers: a dial whose hook already returned can still complete after the stop snapshot.

TUN listener cleanup now treats only standard `net.ErrClosed` causes (including closed-only wrappers/joins) as already released, matching captured connection cleanup. A mixed close error retains the listener and reports the unrelated failure; retry/idempotence tests cover both cases. The distribution/license/provenance gates, pinned upstream/hashes and physical-device TUN/leak/battery acceptance requirements remain unchanged. Current-source native CI and dedicated packaging must still be distinguished from historical artifacts.

### Dedicated Mihomo shared-library package

The native workflow now builds `./angelanexus_android`, a dedicated package inside the fixed upstream module containing the exact bridge, lifecycle helper and minimal library entry. It no longer compiles the upstream CLI `main.go`, whose `init()` parses the embedding process's arguments. Host tests exercise the whole same package rather than an explicit file list that excluded CLI startup only during tests. Core imports remain real; their background initialization is not claimed to be stopped.

Package tests verify no CLI flags were registered and the installed cgo socket hook fails closed without a VpnService symbol. A real host `c-shared`/`ctypes` smoke covers exported configuration calls, error-result freeing, invalid TUN start, repeated stop and reconfiguration, with a bounded subprocess. This is host library integration evidence, not Android TUN, VPN protection or full-core shutdown evidence. CI still restores the exact Android bridge constraint before all three NDK ABI builds.

Native provenance now includes the dedicated build package and SHA-256 of `library.go`. The packaging verifier rejects missing/mismatched package or entry evidence, including historical root-package builds; runtime artifact hashes, fixed upstream revision and all license/source/naming/distribution approval gates remain unchanged. New native builds do not automatically become approved or shipped libraries. Full dial cancellation/draining, late tracker registration, unregistered connections and upstream background-task termination still require an upstream lifecycle contract; physical-device TUN/leak/battery acceptance remains outstanding.

### Serialized upstream configuration parsing

The native bridge now holds the lifecycle mutex before upstream `config.Parse`, through application and saved-configuration commit; home-directory initialization uses the same mutex. Upstream parsing temporarily writes global settings and rolls them back, so the former parse-outside-lock path could race another apply/DNS update and restore stale settings. Shared non-cgo bodies keep exported and host-tested paths identical. Invalid configurations leave the committed JSON and upstream mode intact.

A concurrent pinned-upstream regression interleaves configuration, DNS updates, initialization and stop, checks committed/upstream mode agreement and verifies unattached admission stays closed. Restoring the old lock boundary triggers real race-detector failures. The repaired helper and dedicated upstream package each passed 20 race repetitions locally; the JavaScript verification suite passed 1,197 tests. A rebuilt host shared library also passed exported calls from concurrent ctypes threads, in addition to the existing load/configuration/invalid-start/repeated-stop smoke. Three pinned kernels again passed forwarding and upstream-refusal/no-direct-fallback traffic tests. Current-commit CI remains a separate check, not implied by this local evidence.

This serializes bridge control calls, not every upstream background task or Kotlin caller's multi-call sequence. It adds no cancellation/deadline for parsing/application: stop may wait for them to finish. Full dial completion/late tracker registration, unregistered connections, NAT and background-task termination remain incomplete, as do physical-device TUN/leak/battery acceptance. Fixed versions and artifact hashes, license/source/naming/distribution approvals and the no-implicit-fallback policy are unchanged.

### Stop admission while configuration holds the control mutex

Mihomo stop now announces a counted pending request and drains socket hooks before waiting for the lifecycle control mutex. A configuration parse/apply can still finish while holding that mutex, but readiness restoration is serialized with the admission barrier and cannot reopen protection over a queued stop. TUN startup, apply resume and explicit resume honor pending stops. Concurrent stop callers retain separate requests through successful or failed cleanup; listener/tracker ownership remains serialized and failed cleanup is still retryable.

Host regressions queue one/two real stop calls behind the held control mutex, reject new hooks without invoking protection, then verify cleanup/error ownership and blocked resume. Helper regressions cover an in-flight protection callback and concurrent readiness restoration. This narrows the pre-cleanup admission window only: parse/apply still has no cancellation/deadline, already-admitted dials and late/unregistered connections remain outside the snapshot contract, and DNS/provider/NAT/statistic background shutdown and real-device TUN/leak/battery acceptance remain incomplete. License/source approval and pinned-version/hash distribution gates are unchanged.
