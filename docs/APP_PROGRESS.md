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

### Explicit pause also gates new native socket hooks

Mihomo's exported `suspend(1)` now records an independent pause state, invalidates pre-pause hook epochs, and drains protection callbacks before returning. Previously it only suspended tunnel ingress: a background dial could still enter the socket hook and report successful protection after pause. Explicit resume clears only the pause flag, never invents readiness after stop or failed attachment, and cannot override a queued stop. Configuration application preserves explicit pause. As before, a newly and successfully attached TUN starts unpaused; unsuccessful replacements do not clear pause.

A pinned-upstream regression first reproduced the old behavior (`explicit suspend admitted a new socket`). Helper tests cover callback draining, repeated pause, stale hooks across pause/resume without a configuration transition, configuration while paused and pending-stop priority. Bridge tests exercise the actual suspend body, apply/resume, stop/resume and invalid replacement. The real shared-library smoke now includes pause/resume calls from a fifth concurrent ctypes worker. Local JavaScript verification passed 1,199 tests, and the helper and pinned-upstream bridge each passed 20 race repetitions; host shared-library and all three kernels' positive/negative traffic smoke passed. These are host results, not current-commit Android CI or physical-device acceptance.

At this stage pause waited for the serialized control mutex before closing its gate; the following queued-pause change removes that admission window. It adds no cancellation or deadline for parsing/application or a stuck protector. It does not close existing sockets, wait for complete dials or prevent late tracker registration, and does not stop DNS/provider/NAT/statistic background tasks. Physical-device TUN/leak/battery validation, approved artifact hashes and license/source/naming/distribution gates are unchanged.

### Queued pause closes socket admission before waiting for control

The exported pause now announces a counted pending request and drains socket protection callbacks before waiting for `androidTunMu`. A parser/apply holding that mutex can still finish, but an already-running resume/start cannot bypass queued pauses by clearing the pause flag or restoring protection. Each pause reasserts its final state under the control mutex and retires its own pending count before unlocking, preserving listener/protection ownership while allowing a genuinely later explicit resume. Stop retains its independent priority and failed cleanup ownership.

The previous exported pause body fails the deterministic pinned-upstream test for both one and two queued pause callers. Helper tests cover the pending-pause admission rule, old epoch rejection and draining an entered protector before waiting for control. The bridge test holds the actual control lock, exercises queued exports and attempts to restore readiness, then verifies preserved listener ownership, paused tunnel state and subsequent explicit resume. Local verification passes 1,200 JavaScript tests, 20 helper race repetitions, 20 pinned-upstream bridge race repetitions, host c-shared multithreaded export smoke and all three kernels' positive/negative traffic smoke. These are host results, not current-commit native CI or Android TUN acceptance.

No upstream source or version pin changes are introduced. The fixed upstream has no complete-dial or tracker-registration admission hook; repeating its tracker snapshot or calling `executor.Shutdown()` would not establish complete termination. Already-admitted/late/unregistered connections and DNS/provider/NAT/statistic background shutdown remain unresolved. Parsing/application/protection and individual cleanup operations still have no new cancellation or deadline. Real-device TUN/leak/battery acceptance, artifact hash approvals and all license/source/naming/distribution gates remain unchanged.

### Queued configuration cannot outlive a superseding stop

Config and DNS-update requests now retain their entry-time stop generation across the control-lock wait. Any pending stop rejects them immediately; after lock acquisition, a stale generation rejects them even when stop has already completed and its pending count is zero. Each stop increments the generation, independently of pause/configuration socket-hook epochs. Rejected requests return an explicit retryable error and leave saved JSON and upstream configuration unchanged. Fresh requests after stop remain supported and do not imply an attached/running TUN.

The final check under the control mutex admits the operation for execution. Stop announced after that boundary may still wait for the admitted parse/apply/JSON commit, even if the parser has not yet been called. Parsed results are not discarded: upstream objects may hold resources and require their own audited cleanup contract. This change prevents stale queued transactions, not parser cancellation, bounded stop latency or full native shutdown.

Local validation passes 1,202 JavaScript tests, 20 Go helper race repetitions, 20 pinned-upstream bridge race repetitions, host c-shared multithreaded exports and three-kernel positive/negative traffic smoke. Disabling the new checks reproduces both pending-stop and completed-stop regression failures. Concurrent shared-library tests accept only the specific config/DNS stop-rejection error; ordinary errors and failed fresh retries remain failures. CI/current-artifact packaging and real-device validation are separate gates. Full dial completion, late/unregistered connections, background cleanup and timeout/cancellation remain open; upstream/native hash pins and all licensing/release gates are unchanged.

### Queued TUN startup cannot outlive a superseding stop

TUN-start requests now retain an entry-time stop generation, with an early pending-stop rejection at the C export and a second check after acquiring the control mutex. The locked check precedes tunnel suspension, current-resource cleanup, argument validation, descriptor duplication and listener construction. An older queued start therefore cannot restart after a completed stop or close resources already owned by a newer runtime. Rejection returns the existing zero result and retains the caller's descriptor. Fresh requests remain eligible for normal replacement cleanup; failed fresh starts retain the existing stopped/fail-closed behavior.

Deterministic host regressions exercise the actual export while stop is pending and the control mutex is unavailable, then model a stale start after a completed stop with a newer listener, real upstream TCP tracker and caller-owned pipe descriptor. They verify preserved ownership, pause/admission epoch and descriptor usability; a fresh token still reaches replacement cleanup. Disabling startup generation checks reproduces both failures. Independent code review found no blocking issue. Local verification passes 1,203 JavaScript tests, 20 helper race repetitions, 20 pinned-upstream bridge race repetitions, host c-shared smoke with six concurrent foreign threads (including invalid start), and all three kernels' positive/negative traffic smoke. These remain host results, not real Android TUN attachment or current-commit CI claims.

The initial locked check is an execution-admission boundary, not startup cancellation. The follow-up below adds a separate post-construction commit check; stop can still wait for cleanup/construction. Complete dial exit, late connections/registrations, background shutdown, parser timeout/cancellation and physical-device validation remain open. No upstream revision, native runtime hash, license/provenance or packaging/distribution gate is changed.

### TUN construction superseded by stop cannot commit ownership

Startup rechecks its captured stop generation before descriptor duplication and after listener construction returns. If stop was announced during construction, the bridge first retains the newly constructed listener, then attempts full existing snapshot cleanup and returns false. It does not consume the caller's descriptor, clear the paused state or restore admission. Failed listener/tracker cleanup stays owned for the queued or a subsequent stop to retry. A stop announced after the final commit check may still race with successful startup and is responsible for subsequent cleanup. No constructor, parse or cleanup cancellation/deadline is introduced.

Host regressions block a per-call constructor in the actual startup body while a real stop announces itself and queues behind the control mutex. Real pipe descriptors verify rejected startup preserves the caller fd, successful cleanup releases only the duplicate, and failed cleanup retains/retries that duplicate through queued and fresh stops. A fresh successful construction still releases the caller fd and owns the duplicate until stop. Removing just the post-construction check reproduces both erroneous-success cases. The production constructor remains the pinned upstream `sing_tun.New`; host tests neither construct nor claim a functioning Android TUN. The existing fresh-success unpaused contract is unchanged.

Local validation passes 1,204 JavaScript tests, 20 helper race repetitions, 20 complete pinned-upstream bridge race repetitions, the host c-shared foreign-flag/six-thread export smoke, and three-kernel positive/negative traffic smoke. Independent code review found no blocking issue. These results do not establish current-commit native CI, latest `.so` packaging, complete dial/late-registration draining, DNS/provider/NAT/statistic shutdown or physical-device leak/battery acceptance. Upstream/native artifact pins and all licensing, provenance and distribution gates remain unchanged.

### TUN duplicates cannot select upstream's descriptor-zero sentinel

The bridge now duplicates the caller's descriptor with `unix.FcntlInt(..., F_DUPFD_CLOEXEC, 3)` instead of plain `Dup`. A closed stdin previously allowed duplication to return zero, which the pinned upstream treats as no supplied TUN descriptor. The new atomic allocation reserves all standard descriptors and prevents inheritance across exec, while retaining the existing failure/caller ownership and stop-generation commit boundary.

An isolated-subprocess regression closes stdin and exercises the real startup body with synthetic successful and pre-adoption-failing constructors. It checks the passed descriptor is >=3 and CLOEXEC, successful attachment preserves pipe traffic and releases the caller descriptor, failed construction retains the caller descriptor, and cleanup releases the duplicate. The previous implementation deterministically fails with descriptor zero. This is host descriptor/bridge evidence, not a successful Android TUN test or a complete upstream constructor-error ownership test.

Review also identifies a separate unresolved risk: upstream may close an adopted duplicate during partial construction failure, while the bridge's current error path closes that descriptor number again. Ownership after upstream partial failure must be established before changing cleanup; no safety claim is made for descriptor reuse on that path. Late connects/registrations, full background shutdown, cancellation/deadlines, latest native-artifact packaging and physical-device leak/battery validation remain open. Upstream/hash pins and license/provenance/release gates are unchanged.

Local validation passes 1,205 JavaScript tests, 20 standalone helper race repetitions, 20 complete pinned-upstream bridge race repetitions (including isolated success/failure children), host c-shared foreign-flag/six-thread export smoke and all three kernels' positive/negative traffic smoke. The isolated new regression also passed three focused race repetitions before the full run; restoring plain `Dup` reproduces descriptor zero. Independent review found no blocking issue in this change. Current-commit CI/native compilation is tracked separately from these local results.

### Mihomo constructor-error descriptor ownership

The duplicate-fd failure path now uses an explicit consuming constructor, `sing_tun.NewWithOwnedFD`, rather than guessing whether upstream has already closed a descriptor number. A checked-in preparation script adapts only the pinned Mihomo/sing-tun implementation and fails closed for incompatible source. Pre-adoption failures close through the adapter guard; post-adoption failures close through the upstream listener. The bridge does not close the duplicate again after an error. The original caller descriptor is still retained on rejection and consumed only at successful commit.

New isolated host cases exercise consuming synthetic failure plus actual upstream early DNS validation and post-adoption unknown-stack failure. They force the closed number to refer to an unrelated pipe before returning to the bridge, then check both that pipe and the caller's pipe remain usable through rejection and a later stop. Existing success, CLOEXEC/closed-stdin and stop-during-construction regressions remain required. These tests do not imply successful Android TUN attachment, general panic cleanup or complete core shutdown.

The build records the adapter and adapted-source digests, and artifact verification requires matching evidence in addition to its existing checks. Pinned versions, existing packaged-library hashes and all license/distribution restrictions remain unchanged; new build output has not been installed into the application. Full dial cancellation/exit, late connections and registrations, background cleanup, new-library packaging, physical-device TUN/leak prevention and battery validation remain open. Validation results for this revision are recorded separately in PR #133; this section is not a claim that pending CI or device work has passed.

Local validation of this ownership adaptation passes 1,215/1,215 JavaScript tests, the focused three-mode ownership regression repeated three times under race detection, 20 standalone helper race repetitions, 20 complete pinned-upstream bridge race repetitions, the host c-shared foreign-flag/six-thread smoke, all three kernels' positive/negative loopback traffic smoke, and actionlint. Restoring only the bridge's old error-path close deterministically fails the new reuse regression with `bad file descriptor`. The adapter also applies idempotently to a fresh pinned worktree and the test suite rejects wrong commits, unexpected source changes and marker-only fake patches. These are local results; current-commit CI and physical-device acceptance remain separately tracked.

### Joined default-statistics worker lifecycle

The pinned upstream manager's periodic sampler now has a reviewed, hash-checked adaptation with idempotent `StartStatistics` and synchronous `StopStatistics`. Stop signals the worker, waits for its completion and releases the ticker before allowing a restart. The bridge stops the sampler during shared-library initialization and after every listener cleanup attempt, including failed stop and invalid replacement. Only a committed successful attachment restarts it. Explicit pause/resume on an attached runtime does not tear down its sampler; configuration cannot start one on an unattached runtime.

Stopping clears instantaneous rate fields, not accumulated totals or remaining pending counters. Pending traffic can be included in the first resumed sample; this is not a continuous one-second throughput estimate across a stopped interval. Counter writes and tracker registration remain independent of sampler lifetime. Tests inspect the actual worker completion signal, block restart behind a pending join, retain totals across restart, and exercise real sampling through the bridge's stop/failure/replacement and synthetic reattachment paths.

The preparation script now verifies pristine and adapted manager digests plus the exact checked-in statistics patch. Native provenance records both patch and adapted-source digests; the packaging verifier requires them and rejects older evidence that lacks the new contract. The fixed upstream revision, historical packaged-library hashes, license/provenance approval requirements and distribution gates remain unchanged. No newly built `.so` is installed into the application by this change.

This is one joined background worker, not runtime-wide shutdown. Full dial cancellation/exit, a late-connection/registration barrier, provider health checks/fetchers, DNS and UDP/NAT worker termination remain unresolved. A tracker-only gate cannot cancel a dial already admitted before stop, and an epoch sampled only when a late constructor begins cannot identify the old dial across replacement. These require their own admission, ownership, cancellation and join contracts. Physical-device TUN/leak/battery validation and reviewed latest-library packaging remain incomplete. This section describes the implementation and test scope; exact validation and current-commit CI results are tracked separately in PR #133.

Local validation passes 1,231/1,231 JavaScript tests, 20 standalone helper race repetitions, 20 default-statistics package race repetitions, 20 complete fixed-upstream bridge race repetitions, the host c-shared foreign-flag/six-thread smoke, three-kernel positive/negative loopback traffic smoke and actionlint. Removing the bridge's statistics-stop call fails all three new cleanup scenarios; removing the worker join is caught by the statistics completion/serialization regressions. The combined adapter applies idempotently to a fresh pinned worktree, and fixture tests reject changed patch input/output and missing or tampered build evidence. Independent review found no blocking issue. These are local results; current-commit native CI and physical-device acceptance are separate.

### Ordinary tunnel late TCP/UDP results cannot borrow a replacement epoch

The next bounded cleanup milestone adds generation-aware tracker registration to the fixed upstream's ordinary TCP and UDP tunnel handlers. Each handler captures its epoch at entry, before dialing, and atomically joins with that token only after a successful result. Bridge initialization and every cleanup close registration and invalidate older tokens before listener close; only a committed successful attachment reopens the current generation. A late result from the old runtime is rejected and closed even if a new attachment has already started. The original generic tracker APIs remain compatible for other upstream users.

Connection close runs outside the registration mutex. Genuine rejected-result close failures retain ownership for a future stop/replacement, including mixed closed-plus-real errors. A late failure cannot retroactively alter a stop that has already returned. Ordinary tracker snapshots and the bridge's existing failure retry path remain separate from the new final registration admission check.

This is late-result reclamation, not dial cancellation or a worker join. It does not promise that stop waits for delayed dials, suppresses every pre-tracker TCP handshake, terminates DNS/provider work, or clears UDP/NAT state. The early socket-hook barrier still begins before the control-lock wait; the new tracker barrier closes during locked cleanup. New `.so` packaging, licensing/distribution approval and physical-device TUN/leak/battery checks remain separate incomplete gates. Exact local and current-commit CI results belong to the validation record in PR #133; older successful CI is not evidence for this new source.

Local validation passes 1,247/1,247 JavaScript tests, 20 standalone helper race repetitions, 20 combined statistics/registration package race repetitions, 20 actual TCP/UDP handler race repetitions, 20 complete fixed-upstream bridge race repetitions, the host c-shared foreign-flag/six-thread smoke, all three kernels' positive/negative loopback traffic smoke and actionlint. Restoring only the original ordinary tunnel handler source makes both stale-result regressions fail, while current-generation controls forward actual TCP and UDP payloads. New adapter tests verify pristine/intermediate/final inputs, idempotent preparation, exact paths and all-or-no-source-replacement on patch/output-digest rejection. Independent review found no blocking implementation issue. These remain local results; current-commit CI, replacement-library packaging and physical-device acceptance are tracked separately.

The first CI run of this milestone compiled the native library but failed during provenance generation because four new digest variables had not been assigned in the workflow shell. The follow-up computes them from the checked-in patch and actual final upstream files, and executes the real provenance shell body in controlled fixtures for all three ABIs; each fixture reproduces the old unbound-variable failure and requires the exact generated output hashes after the fix. This is a workflow evidence-generation correction, not a change to the Go implementation or historical packaged artifacts. The late-patch no-partial-replacement guarantee concerns its three output files after all three are validated, not a transactional rollback of earlier owned-FD/statistics preparation stages.

After the workflow correction, full local verification passes 1,250/1,250 JavaScript tests, including successful execution of the provenance shell for each ABI and exact late-patch/final-source digest assertions. The previously completed Go/race, host shared-library and three-kernel traffic evidence remains applicable because this follow-up does not change Go source or its preparation adapter. Final native CI is still a separate current-commit check.

### TCP early handshakes and retryable real tracker ownership

The preceding late-result isolation checked TCP registration only after the optional early-data handshake. A late dial could therefore write peeked payload before rejection. Each successful retry candidate now registers at its captured epoch before handshake; stale rejection cancels that handler's retry context and closes/retains the candidate through the existing owner. The final relay reuses this tracker, and early writes count their actual bytes exactly once. The pinned sing interface lookup follows `Upstream`, preserving early-handshake detection through the statistics wrapper.

Real TCP/UDP tracker cleanup also previously unregistered before the underlying close, losing discoverability on genuine failures outside the bridge's own retained snapshot. It now unregisters only after successful or closed-only cleanup; mixed/real errors remain visible across repeated retries. Reviewed adapter/patch/final-source digests are updated together without changing upstream/dependency pins, historical packaged `.so` hashes, licensing approvals or release gates.

This change is not complete kernel exit, general dial cancellation/joining or handshake/cleanup deadlines. An already admitted candidate can overlap stop. Independent review also identified a separate unresolved same-key UDP NAT sender reuse/cleanup generation problem; ordinary tracker isolation alone does not solve it. DNS/providers, full UDP/NAT workers, latest `.so` installation and physical-device TUN/leak/battery acceptance remain outstanding. PR #133 must remain unmerged/unreleased pending the existing gates.

Local verification for this follow-up: **1,252/1,252 JavaScript tests**; **20 helper**, **20 statistics/registration**, **20 actual tunnel** and **20 complete pinned-upstream bridge** race repetitions passed. Actual TCP tests cover preloaded early data, stale-result zero writes, fresh payload/counting, handshake failure with a fresh retry, and REJECT's no-retry/cleanup behavior. Restoring the previous tunnel body demonstrably sends one stale payload byte; restoring the old tracker close order loses the failed-close tracker and fails the new retry regression. The earlier bridge failure was an obsolete unregister-on-failure assertion: it now checks new manager retention, then explicitly simulates independent unregistration to retain coverage of bridge-owned retries. The host shared-library foreign-flag/six-thread smoke and all three kernels' positive/negative loopback traffic passed, with Mihomo rebuilt from this adapted source. Clean-source preparation is repeatable/idempotent; tamper/provenance regressions and actionlint passed. Independent read-only review found no blocker under the documented pre-registration admission contract. These are local/host results; current-commit CI is recorded separately and does not establish new `.so` packaging or physical-device acceptance.

### TUN UDP same-key generations and sender-owned NAT cleanup
TUN UDP sender keys now include the captured registration epoch, so a same-address packet in a restarted TUN cannot enter an old sender while its dial is still pending. This namespace is restricted to `C.TUN`; TProxy and other inbound paths retain their bare local-address key because TProxy write-back uses it for local sockets and creation locks. Failed-dial removal and receive-loop cleanup compare sender ownership atomically with a single-key `xsync.Map.Compute`. Receive cleanup detaches the owned entry before snapshotting and closing only that entry's sockets outside the table lock. It never looks up a replacement's sockets by the reused key.

The reviewed patch now covers five exact upstream source files. Preparation pins pristine inputs, patch bytes and final outputs, validates all temporary outputs before replacement, and remains idempotent. Native provenance records the NAT-table and connection-handler source outputs for each ABI; the packaging verifier rejects missing, alternate or changed evidence. Existing versions, historical packaged native hashes, licensing and distribution gates remain unchanged.

Local verification passed **1,262/1,262 JavaScript tests**, **20 helper**, **20 statistics/registration**, **20 actual tunnel** and **20 complete pinned-upstream bridge** race repetitions; the host c-shared foreign-flag/six-thread export smoke and all three kernels' positive/negative traffic smoke also passed. Mihomo was rebuilt from this exact adapted source. The full repeated bridge suite takes about 227 seconds: its initial 180-second aggregate test-harness budget expired during an ordinary statistics wait; rerunning the same 20 repetitions with a 600-second aggregate budget passed, without changing production deadlines. Three focused negative controls deterministically fail when restoring the bare TUN key, old unconditional cleanup, or the unsafe all-inbound key prefix. New real-handler tests keep the old dial blocked while fresh same-key traffic succeeds, then verify fresh traffic survives the old result's rejection; real local UDP sockets and creation locks prove owner-only cleanup and non-TUN bare-key compatibility. These tests do not establish privileged TProxy interception.

This resolves the scoped Android TUN sender reuse and replacement cleanup gap, not complete NAT/core shutdown. Non-TUN/TProxy cross-generation ownership, already-captured local-socket creators, best-effort local socket close failures, dial cancellation/joining, DNS/providers and background worker termination remain open. Latest `.so` packaging and physical-device TUN/leak/battery acceptance are still separate, incomplete gates. PR #133 remains unmerged/unreleased; current-commit CI is tracked separately from the local results above.

### Cooperative cancellation for ordinary tunnel setup dials

The pinned-source adaptation now binds ordinary TCP/UDP handler setup to the registration generation's context. Stop invalidates the epoch and cancels its context outside the registration mutex; a committed reopen uses a new context. TCP/UDP retain their existing total retry timeout, now derived from that context. The common retry helper checks for cancellation before its first and every later proxy call, in addition to its context-aware backoff. A setup captured while registration is closed cannot initiate a proxy attempt.

Cancellation-aware and deliberately cancellation-ignoring proxy regressions are separate requirements: honoring cancellation must end setup without waiting for the proxy's manual release, while ignored cancellation must still trigger epoch-based late-result closure before payload or relay activity. Fresh TCP/UDP traffic and TUN same-key sender isolation remain covered. This is shared generation cancellation, not a per-handler background worker or a claim that asynchronous UDP setup is joined.

Stop still waits for the bridge control mutex before it reaches this cancellation point. Parsing, metadata resolution, sniffing, non-cooperating adapters and already-admitted relay operations have no new forced-exit guarantee. Full dial joining, DNS/provider shutdown, non-TUN/TProxy comprehensive generation isolation, latest `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. Upstream versions, historical native artifact hashes, license/provenance/distribution gates are unchanged. PR #133 remains unmerged and unreleased; exact current-revision local and CI results are recorded separately.

Local validation for this cancellation change passes **1,264/1,264 JavaScript tests**, 20 standalone lifecycle-helper race repetitions, 20 statistics/registration package race repetitions, 20 actual tunnel-handler race repetitions and 20 complete pinned-upstream bridge race repetitions. Clean-source preparation is idempotent. The rebuilt host c-shared library passes six-thread C-export smoke, and a separately rebuilt adapted Mihomo passes the three-kernel positive/negative loopback traffic suite alongside sing-box and Xray. Three negative controls remove the TCP context parent, UDP context parent or first-attempt cancellation check; each fails its intended deterministic regression. Actionlint and whitespace checks pass. These are host results; current-commit CI, packaging and physical-device acceptance are not inferred from them.

### Retryable bounded drain of ordinary setup work

An epoch-checked setup lease now counts ordinary TCP dial/retry/early-handshake and asynchronous UDP dial setup. Releasing is idempotent, and outstanding leases survive stop, timeout and reopening. Closing registration prevents new setup acquisition; work that was still resolving metadata before that boundary cannot later start an old-generation dial. TCP pre-dial metadata/sniffing and synchronous UDP packet prechecks are not counted; the UDP asynchronous setup lease includes its own sniff/metadata resolution and failure cleanup without adding forced cancellation. Relay loops, UDP/NAT workers, DNS and provider workers are not joined.

Android cleanup closes captured trackers before waiting, so an admitted early handshake can be unblocked by socket close. It then gives counted setup work a two-second drain budget. Timeout is a real cleanup error: it preserves pending work for stop retry and prevents replacement startup through failed cleanup. This budget is not an overall stop deadline; control-lock acquisition, cancellation callbacks, listener and connection close can still block. A second manager check rejects apparent success if a late rejected result retained a genuine close failure after the first snapshot; ownership remains available to the next stop.

This completes only bounded accounting/waiting for the ordinary setup boundary. Full kernel exit, non-TUN/TProxy comprehensive generation isolation, pre-dial cancellation, DNS/provider cleanup, newly built `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. Fixed versions, historical native hashes, licensing/provenance/distribution gates are unchanged. PR #133 remains unmerged/unreleased. Current-revision test and CI evidence is recorded separately; an unrun check is not inferred from this implementation description.

Local verification: **1,266/1,266 JavaScript tests**, **20 helper**, **20 statistics/registration**, **20 real tunnel-handler** and **20 complete bridge** race repetitions passed. The extra cross-generation ledger/open-gate/canceled-wait/concurrent-release tests also passed 20 race repetitions. The complete bridge group took 306.859 seconds within its unchanged 600-second aggregate test budget; production setup drain remains two seconds. The actual adapted host c-shared library passed foreign-flag/six-thread exports, and the adapted Mihomo CLI passed positive/negative loopback traffic alongside sing-box and Xray. Four negative controls separately removed TCP accounting, UDP accounting, bridge waiting or late-close error reporting; each reproduced its intended failure. Clean-source preparation/idempotence, provenance/tamper regressions, actionlint and diff checks passed. Independent review found no blocking implementation issue within the documented boundary. The initial wrong-input patch generation and test-only interface assertion were corrected before submission; no source/provenance check was relaxed. Current-commit CI and physical-device acceptance are separate evidence.

### UDP sender queue admission is atomic with close

A shutdown race existed independently of setup accounting: `Send` could pass its first cancellation check, pause while `Close` canceled and drained the queue, then randomly choose the writable queue branch instead of the simultaneously ready cancellation branch. With the consumer gone, that packet could retain its buffer without a corresponding `Drop`.

The reviewed upstream adapter now serializes the canceled-state check and nonblocking enqueue with sender cancellation using one queue mutex. Once close cancellation commits, no later send can enqueue. Rejected/full-queue packets and drained packets are dropped outside the mutex so arbitrary `Drop` callbacks may safely re-enter `Close` or `Send`. Concurrent closes consume distinct queued packets rather than double-dropping them. The existing five-source adapter/provenance contract includes updated exact UDP connection-source and patch digests; no source-verification bypass is introduced.

Regressions exercise concurrent Send/Close packet ownership, concurrent closes, and reentrant Drop callbacks for queue drain, full queue and already-closed admission. The race test checks ownership before any second drain so retry cleanup cannot hide a retained packet. All remain in the real-tunnel CI selection. This is queue admission/ownership synchronization, **not a join of Process, receive loops, NAT or all kernel workers**. A consumer already owning a packet may still be running after Close returns; this change alone does not cancel all DNS resolution or prevent all already-admitted forwarding.

The two-second setup wait remains unchanged and is not an overall stop deadline. Full kernel exit, pre-dial cancellation, DNS/provider cleanup, comprehensive non-TUN/TProxy isolation, new `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. Upstream versions, licenses, historical packaged-library hashes and all release gates remain unchanged. PR #133 remains unmerged and unreleased. Exact local/current-commit CI evidence is recorded separately after execution; no test result is inferred from this implementation description.

Local verification passed **1,268/1,268 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 real-tunnel** and **20 complete bridge** race repetitions. The three new sender tests also passed a separate 20-race run; the queue race exercises 512 batches of 64 concurrent packets per repetition. Complete bridge tests took 308.299 seconds within the unchanged 600-second test budget. Clean-source adapter preparation/idempotence, exact provenance/tamper regressions, actionlint, focused 15-test contracts and diff checks passed. The actual adapted host c-shared library passed the foreign-flag/six-thread smoke, and the adapted Mihomo CLI passed positive/negative loopback traffic with sing-box and Xray. Two negative controls restored the old select race or moved Drop under the queue lock; each reproduced its intended retained-packet/deadlock failure. The initial negative-control build exceeded its outer command budget before reporting a test result; it was rerun successfully after dependencies were built. Independent review found no blocking issue within the documented queue-only boundary. Current-commit remote CI and physical-device acceptance remain separate evidence.

### Cancellation checkpoints for dequeued UDP packets

The ordinary UDP sender now rechecks cancellation after dequeue, before packet processing, after a successful resolver returns and before installing its mapping, and immediately before `WriteTo` after reading packet data. A resolver that ignores cancellation and returns success cannot resume forwarding when the cancellation is already visible. Write-back and packet-data callbacks may re-enter `Close`; their return paths observe cancellation before continuing to forwarding. A canceled write does not start a subsequent read-deadline refresh. Each dequeued packet remains consumer-owned until its single deferred `Drop`; `Close` drains only packets still in the queue. No external callback runs under the queue mutex.

Deterministic regressions cover blocked write-back and resolver callbacks returning after `Close`, late resolver success/error, write-back/data/write callback reentry, canceled dequeue selection, exactly-once release, and fresh forwarding controls. A write callback that closes the sender is intentionally allowed to complete its already-entered write, while the subsequent deadline update is suppressed. These tests are selected by the existing real-tunnel CI group. Patch and final connection-source digests change together; upstream pins, versions, historical packaged-library hashes and provenance/license/distribution gates remain unchanged.

These are cancellation checkpoints, not an atomic shutdown barrier or a Process join. Cancellation may race the gap between a final check and the next callback or `WriteTo`; `Close` can return while an already-admitted callback/resolution/write remains active. Such work retains packet ownership until it returns. This revision does not promise zero traffic after `Close` returns, runtime-wide exit, non-TUN/TProxy generation isolation, DNS/provider shutdown, new `.so` packaging or physical-device TUN/leak/battery acceptance. The two-second wait remains the ordinary-setup-only budget, and PR #133 remains unmerged and unreleased. Current-revision validation and CI are recorded separately rather than inferred from earlier successful revisions.

### Cancellation checkpoints for reverse UDP replies

The ordinary UDP receive loop now retains the registration-generation context, not the short-lived dial timeout that is canceled as soon as setup returns. It checks cancellation before receive/deadline work, after the deadline callback, after `WaitReadFrom`, and after destination-NAT restoration before `WriteBack`. A reader that ignores closure and returns a late successful buffer can no longer resume reply forwarding once generation cancellation is visible. Returned buffers are released once on cancellation, read errors and ordinary write-back completion, including optional nil release callbacks. No lock is added across read, mapping, release or write-back callbacks.

This is a reverse-path checkpoint improvement, not a receive-loop join or an atomic write barrier. Cancellation can still race the final check-to-call gap; an already-entered `WriteBack` may complete and retains buffer ownership until it returns. A context does not force a non-cooperating read to wake; connection close remains the existing unblocking mechanism. Independent sender closure is not a new registration-context cancellation source. Full core/relay/NAT exit, complete pre-dial cancellation and non-TUN/TProxy generation isolation, DNS/provider cleanup, new `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. The two-second budget remains setup-only, and upstream pins, versions, historical artifacts, licensing/provenance and release gates are unchanged. PR #133 remains open, unmerged and unreleased; current-revision validation is recorded separately.

Local verification passes **1,273/1,273 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual-tunnel** and **20 complete bridge** race repetitions, plus **20 focused reply** race repetitions on the final strengthened ownership/error/blocked-write controls. Complete bridge took 309.487 seconds within the unchanged 600-second aggregate harness budget. Clean-source preparation/idempotence, exact patch/source/provenance/tamper checks, actionlint, actual adapted host c-shared foreign-flag/six-thread smoke and positive/negative loopback traffic through all three kernels passed. Three negative controls restore the old reply path, omit buffer release or incorrectly pass the dial context; each deterministically fails its intended stale-forwarding, ownership or healthy-roundtrip regression. Independent review found no production blocker within the documented checkpoint contract; context cancellation alone does not wake a blocked read, and callback panic recovery is not introduced. Current-commit remote CI, packaging and physical-device acceptance remain distinct evidence.

A final whole-tunnel repetition initially failed the older fresh-UDP cleanup assertion: observing the outbound request did not prove that the independently scheduled reverse goroutine had entered `WaitReadFrom`. With the new entry cancellation check it may validly exit before reading, so the old read-method-only completion signal could never fire. The blocked-reader/setup-only-drain control now explicitly waits for reverse read entry before announcing stop, without adding sleeps or extending any timeout. Separate canceled-at-entry coverage still requires skipping the read entirely. The failed run is retained as evidence rather than attributed to a production deadlock.

### UDP senders inherit registration-generation cancellation

Ordinary UDP sender construction now derives its forwarding context from the registration generation, independently of the reverse reader's deferred cleanup. Previously a blocked reverse reader could delay sender.Close and leave the outbound queue using an unrelated Background context. Existing dequeue, resolver, callback and pre-write checks now observe generation cancellation directly. The Background constructor remains available for compatibility; normal tunnel creation uses the context-aware constructor.

Process defers Close so a parent-canceled consumer serializes its final queue drain against Send and returns queued packets exactly once, outside the queue mutex. No AfterFunc or extra cancellation goroutine is added. A blocked external callback, resolver or admitted write is not forcibly joined: its packet stays consumer-owned until it returns, and queue drain may wait for that return or another Close. A write already entered may complete; the last-check-to-write gap remains. This is not zero post-stop traffic or a full kernel exit barrier.

The setup-only two-second budget, upstream pin, versions, historical packaged-library hashes and licensing/provenance/distribution gates are unchanged. No new .so is packaged or installed. Full relay/NAT/reader exit, complete non-TUN/TProxy generation isolation, DNS/provider cleanup and physical-device TUN/leak/battery acceptance remain incomplete. PR #133 remains open, unmerged and unreleased; exact current-revision validation is recorded in the PR.

The upstream QUIC multi-packet sniffer wrapper is not made cancellation-aware by this change: its DoSniff can still wait for its own timeout and wrapper-owned buffers/cleanup are not joined by the underlying sender's Process defer. This remains part of the incomplete sniff/setup shutdown boundary.

Local validation for the sender-parent change: **1,275/1,275 JavaScript tests**, 20 standalone lifecycle-helper race repetitions, 20 statistics/registration race repetitions, 20 actual tunnel race repetitions, and 20 complete bridge race repetitions (309.237 s within the unchanged 600 s harness budget) passed. New controls cover late resolver and write-back returns after parent cancellation, Data reentry, idle exit, queued Drop/Close/Send reentry, already-entered writes and actual handler wiring while reverse read remains blocked. Clean-source/idempotent preparation, reviewed digest/provenance/tamper fixtures, host c-shared foreign-flag/six-thread smoke, three-kernel positive/negative loopback traffic, actionlint and diff checks passed. Three isolated negative controls detach the parent, omit Process's final drain, or restore the handler's Background wiring; each reproduces its intended regression. Independent production review found no blocker within the ordinary sender boundary, and identified the retained QUIC wrapper limitation documented above. Current-commit CI remains separately recorded, not inferred from local results.

### Canceling UDP multi-packet sniff setup without a global exit barrier
UDP setup now scopes a registration-context cancellation callback to its `DoSniff` wait. Cancellation invokes the sender's existing `Close` contract, waking the QUIC wrapper rather than requiring its ordinary three-second collection timeout. A post-sniff context checkpoint rejects closed-sniffer success from a canceled generation before metadata resolution/dial setup continues. The cancellation callback is deregistered on every normal/error return; stopping the callback does not wait for an already-running callback. A pre-canceled context does not enter sniffing.

QUIC result delivery copies the sniffed hostname under its internal lock, then invokes domain replacement without that lock. A callback may therefore re-enter wrapper `Close` without a lock inversion. The reviewed QUIC source joins the exact-input/exact-output patch and artifact-provenance boundary; an unknown, mixed or tampered sixth source is not accepted. Existing historical packaged-library hashes are not rewritten to imply this patch is installed.

This is cooperative setup cancellation, not a timeout guarantee or complete shutdown barrier. A blocked external callback, packet `Data`, resolver or already-entered write may continue until it returns; callback wakeup does not imply all Drop callbacks have joined. Cancellation may still race the gap between a checkpoint and the next operation. Queue packets remain owned by the existing sender drain and each dequeued packet by its consumer; no new packet ownership transfer is introduced. The ordinary QUIC three-second timeout and the bridge's two-second setup wait remain unchanged. Full kernel exit, DNS/provider cleanup, new `.so` packaging and physical-device TUN/leak/battery acceptance remain outstanding. Upstream pins, versions, licenses and release gates stay unchanged; PR #133 remains unmerged and unreleased. Verification results are recorded only after their commands complete.

Local verification for this follow-up passed **1,284/1,284 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual tunnel** and **20 complete pinned-upstream bridge** race repetitions. Complete bridge tests finished in 308.741 seconds within the unchanged 600-second budget. The real QUIC wait/checkpoint group and the QUIC callback-reentry test each passed **100 additional race repetitions**; the complete upstream sniffer package also passed under race. Three negative controls reproduced the intended missing-wakeup timeout, canceled-success admission and held-lock callback deadlock. Final-source preparation is repeatable/idempotent including staged QUIC tests; sixth-source input/output/path/mixed-tree tamper cases, three-ABI provenance shell fixtures, exact artifact verifier regressions and actionlint passed. The adapted host c-shared library passed the foreign-flag/six-thread smoke, and rebuilt Mihomo plus sing-box and Xray passed positive/negative loopback traffic.

The first full JavaScript run exposed outdated artifact fixtures missing sixth-source evidence; fixtures were corrected without weakening the verifier and the complete suite then passed. The native runner's shell continuation was interrupted after all four race groups had completed; its successful bridge log was preserved and remaining QUIC/library/traffic checks were resumed separately and passed. Independent read-only review found no blocker within the documented setup-checkpoint/non-join boundary. These are local host results, not new Android library installation or physical-device acceptance; current-commit remote CI is recorded separately.

### TCP sniff wait observes registration-generation cancellation

The TCP handler now checks generation cancellation before sniffing and installs an inbound-close callback only for the `TCPSniff` call. Stop can therefore wake a normal blocked sniff read instead of waiting for its sniff deadline. After sniffing returns, the callback is unregistered and cancellation is checked again before metadata resolution, background peeking or setup/dial admission. A reader that ignores Close and later returns a valid HTTP result is rejected at that checkpoint. The existing handler defer continues to own inbound closure on all early returns; no additional connection ownership is transferred.

Real HTTP/TLS dispatcher regressions cover blocked-read wakeup with Close re-entering `StopRegistrations`, a pre-canceled handler that never enters Read, late successful HTTP after a non-waking Close with zero subsequent rule-resolution calls, and normal domain sniffing plus actual request relay. The initial new fixture left `ParsePureIp` disabled, causing its Read signal to come from background peeking and a misleading early-dial failure. The fixture now explicitly enables pure-IP sniffing, checks the positively sniffed domain, and ignores read deadlines to prove cancellation/Close rather than a timer woke the read. No production timeout or guard was relaxed.

Local validation passed **1,286/1,286 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual tunnel** and **20 complete pinned-upstream bridge** race repetitions; complete bridge tests finished in 308.052 seconds. The four new TCP sniff tests passed **100 additional race repetitions**, and the complete upstream sniffer package passed under race. Three independent negative controls removed cancellation wakeup, the pre-sniff check or the post-sniff check; each failed its intended regression. Clean-source preparation and idempotence, provenance/tamper fixtures, actionlint and diff checks passed. The rebuilt adapted host shared library passed foreign-flag/six-thread smoke, and rebuilt Mihomo plus sing-box and Xray passed positive/negative loopback traffic. These are local host results; current-revision CI is tracked separately.

The callback runs outside manager/handler locks. Its removal does not join a callback that already started, and external code or a connection that violates the normal net.Conn close/unblock contract can remain running. Pre-sniff metadata processing remains outside this cancellation boundary and ordinary setup accounting. This is not complete TCP/core/NAT/relay shutdown, not DNS/provider cleanup, not new `.so` installation and not physical-device TUN/leak/battery acceptance. The existing sniff windows, two-second setup drain, pinned upstream versions, license/provenance/historical-artifact and release gates remain unchanged. PR #133 remains unmerged and unreleased.

### TCP early-handshake cancellation checkpoints

The ordinary TCP setup lease now installs its own scoped inbound-close callback using the existing setup context. This allows generation cancellation or the existing TCP timeout to wake a background peek holding the early-handshake mutex. Cancellation is checked after acquiring the peek mutex, after reading buffered data, after an early write returns and after the retry result. Late successful buffers cannot initiate an early write after visible cancellation; an already-entered write that returns late cannot trigger inbound discard or relay after that cancellation is observed. The setup-only callback is unregistered before relay ownership and on early return, independently of the sniff-only callback.

This is still checkpoint-based cancellation, not an atomic no-write-after-stop guarantee or a full exit barrier. The callback closes only inbound reads; remote writes retain existing tracked-connection cleanup and may remain blocked if an adapter ignores closure. Already-entered Close/callback/write work is not joined, and the final-check race and pre-dial/background-peek/relay limitations remain. The two-second setup wait, pinned sources, historical artifacts, new `.so` packaging and physical-device TUN/leak/battery gates are unchanged. PR #133 remains unmerged and unreleased. Current-source validation is recorded only after commands complete.

Final local validation passed **1,288/1,288 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual-tunnel** and **20 complete pinned-upstream bridge** race repetitions; the complete bridge group took 307.806 seconds. Five new early-handshake tests and the four existing TCP-sniff tests each passed **100 additional race repetitions**; the complete sniffer package passed under race. Five independent negative controls removed setup wakeup, buffered-data checks, the post-write check, final retry-result check or successful callback unregistration; each reproduced its intended regression. Clean-source preparation/idempotence, exact source/provenance/tamper fixtures, actionlint and diff checks passed. The rebuilt dedicated host shared library passed foreign-flag/six-thread smoke, and rebuilt Mihomo plus sing-box and Xray passed positive/negative loopback traffic. Independent read-only review found no blocker within the documented checkpoint/non-join boundary. Current-commit remote CI is tracked separately.

The first tunnel run exposed an old fresh-forwarding fixture canceling immediately after receiving early bytes, before the corresponding Write/setup had necessarily returned. Its positive control now completes a second real relay exchange before testing setup-only drain; accounting includes both payloads. Initial new fixtures also attempted to intercept Peek on a wrapper which ConnContext rewrapped into a concrete BufferedConn; they were replaced with actual BufferedConn buffers, bottom-level Read signals and real callback boundaries. Blocked reads ignore deadlines so Close, not the timer, proves wakeup. Final repeated tests use these strengthened fixtures without relaxing production checks or timeouts.

### Stopped registration tokens cannot borrow a reopened generation

`StartRegistrations` now advances its epoch under the admission mutex on every closed-to-open transition, before publishing the new live context. Tokens obtained while stopped, including from a zero-value manager or repeated stops, therefore remain invalid after reopening. Previously those tokens had canceled contexts but could share the reopened numeric epoch and be accepted by `BeginSetup`, `JoinAtEpoch` or the epoch-aware tracker constructors. Already-open Start remains idempotent and preserves the current context, epoch and outstanding setup ownership. The reviewed patch and exact final manager output digests change together; upstream/dependency pins and historical packaged-library hashes do not.

Local validation passed **1,291/1,291 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual-tunnel** and **20 complete pinned-upstream bridge** race repetitions; the complete bridge group took 308.287 seconds. Five new stopped-token manager tests passed **100 additional race repetitions** covering setup, reentrant rejected Join cleanup, actual TCP/UDP socket closure, retained failed-close retries, concurrent restart and fresh/idempotent controls. Reverting only the reopening epoch increment reproduced erroneous admission in the setup, Join, real TCP/UDP constructor and concurrent-restart groups; these were behavioral failures, not compiler failures or empty selections. Clean-source preparation/idempotence, exact provenance/tamper regressions, actionlint and diff checks passed. The rebuilt dedicated host shared library passed foreign-flag/six-thread smoke, and rebuilt Mihomo plus sing-box and Xray passed positive/negative loopback traffic. Independent read-only review found no blocker within the admission-generation boundary. Current-commit remote CI is tracked separately.

The first full tunnel run exposed an existing HandshakeRetry observation race: the bottom-level Close signal could fire before the outer tracker called manager.Leave. The fixture now waits for the second dial to enter while keeping its return blocked, proving the first tracker cleanup has finished before asserting an empty manager. No production guard or timeout was relaxed. The corrected retry test passed **100 additional race repetitions** and the full tunnel group passed **20 repetitions**.

This fixes generation admission only, not complete kernel exit, forced cancellation/join of already-entered callbacks or remote writes, DNS/provider cleanup, latest `.so` packaging or physical-device TUN/leak/battery acceptance. The existing two-second setup wait, fixed versions, licenses and release gates remain unchanged. PR #133 remains unmerged and unreleased.

### Retire a terminated UDP sender without waiting for its reverse reader

Successful UDP setup now defers sender-owned NAT/local-socket retirement around `sender.Process`. Generation cancellation can end forwarding while the reverse reader remains blocked; previously its NAT entry could remain indefinitely until that reader returned. For non-TUN bare keys this also allowed later packets to keep finding the canceled sender. Once Process returns, the existing `DetachLocalConnsIf` removes only that sender's entry and closes only its captured local sockets outside the table lock. A late old-reader cleanup cannot delete a replacement sender. TUN generation-prefixed keys and TProxy bare local-address keys are unchanged; no new epoch-replacement API is introduced.

The real-handler regression exercises both TUN and TProxy with an old reader deliberately left blocked. It observes retirement and local-socket closure before reopening, then verifies actual fresh UDP forwarding and sender-owned old cleanup. This is **post-Process retirement, not synchronous stop/restart isolation**: Process may still be inside an admitted callback/write, a restart before its retirement can still hit the canceled bare-key sender, and old TProxy local-socket creators are not joined or isolated. DNS/provider shutdown, full kernel exit, latest `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. The production two-second ordinary-setup budget and all version/license/provenance/release gates are unchanged; PR #133 remains unmerged and unreleased.

The successful early-handshake regression now waits for each inbound pipe writer to return and checks its error, with a test-only write deadline. It still verifies real relay traffic before and after setup-generation cancellation. An earlier isolated review run reported a relay EOF, but 1,000 runs of the original fixture did not reproduce it; writer synchronization is test hardening, not proof that an additional production bug was fixed. Removing the real callback-unregistration checkpoint still causes the strengthened test to fail. Current-source local/remote evidence is recorded only after completion.

Final local validation passed **1,293/1,293 JavaScript tests**, **20 standalone helper**, **20 statistics/registration**, **20 actual-tunnel** and **20 complete pinned-upstream bridge** race repetitions; the complete bridge group took 308.286 seconds. The new retirement regression (both inbound types) and strengthened handshake-success regression passed **100 additional shuffled race repetitions**. Removing only Process-owned retirement reproduces retained NAT in both TUN and TProxy; removing only successful callback unregistration reproduces post-stop relay EOF. The immutable final-source review repeated the targeted ownership/handshake group **20 race repetitions** successfully. Byte comparison confirms this revision does not change the preceding adapter's NAT-table APIs; its only production source delta is the deferred cleanup and explanatory comment in the tunnel handler. An initial experimental epoch-replacement approach was discarded rather than introducing new local-creator ownership risks. Clean-source preparation/idempotence, source/provenance/tamper fixtures, actionlint and diff checks passed. The rebuilt dedicated host shared library passed foreign-flag/six-thread smoke; rebuilt Mihomo, sing-box and Xray passed positive/negative loopback traffic. Current-commit remote CI is separate evidence, not inferred from these host tests.

## TProxy late local-socket ownership follow-up

TProxy local socket creation now captures its original NAT entry before opening a socket. The entry serializes publication against retirement, uses per-remote completion channels for single-flight creation, wakes followers on retirement without joining the maker, and closes a successful socket returned by a retired maker. This prevents an already-started old creator from leaking an unowned socket or inserting it into a replacement entry with the same local/remote addresses. All three removal paths (`DetachLocalConnsIf`, `Delete`, `DeleteIf`) retire the entry; ordinary and conditional deletion also close their captured published sockets outside locks. The TProxy caller now uses the ownership-aware API rather than the old condition-variable/create/address-only-add sequence. Legacy `AddForLocalConn` retains its success-only transfer contract: on false its caller still owns the socket, and production TProxy no longer uses it.

New regressions cover positive reuse/single-flight/error retry, retired waiters with an intentionally blocked maker, callback reentry, exact `net.ErrClosed` assertions on real loopback sockets, late maker results after all three removal APIs, and fresh socket liveness after obsolete-owner cleanup. The targeted NAT group passed **100 shuffled race repetitions**. A negative control restoring old address-only publication fails all three late-maker variants; independently removing only the late-result socket close fails their real socket-write checks. The additional adapted `listener/tproxy/packet.go` is pinned and hash-verified together with the seven-section atomic patch, CI provenance and packaging verifier. It is not accepted as an untracked upstream modification.

This is not a maker join or full exit barrier. A maker already executing may outlive stop, but must close its result when it returns. A previously admitted old write-back callback that has not captured its entry yet can still observe a replacement entry; complete generation isolation and immediate-restart zero loss remain unproven. DNS/provider cleanup, latest `.so` packaging and physical-device TUN/leak/battery acceptance remain incomplete. The two-second ordinary-setup budget, upstream pins, historical runtime artifact hashes and all release gates remain unchanged. PR #133 remains unmerged and unreleased. Final-source full local and current-commit remote CI results will be recorded separately after completion.

Final-source local validation passed **1,299/1,299 JavaScript tests**, **20 lifecycle-helper**, **20 statistics/registration**, **20 actual-tunnel**, **20 complete pinned-upstream bridge** and **20 QUIC** race repetitions, plus **100 shuffled NAT local-creation race repetitions**. The full bridge group took 308.125 seconds. Clean-source preparation/idempotence, seven-file transaction/fail-closed fixtures, actionlint and diff checks passed. The rebuilt dedicated host shared library passed foreign-host-flag and six-thread smoke; rebuilt Mihomo, sing-box and Xray passed positive/negative loopback traffic. The late-maker tests use exact `net.ErrClosed` checks and verify replacement socket liveness after the old creator completes and obsolete-owner cleanup runs. Current-commit remote CI remains separately tracked; this local result does not imply new Android library packaging or device acceptance.

## Policy-specific DNS connection reset

- The pinned-source DNS adapter now includes policy-only transports in connection-reset ownership, rather than resetting only main/fallback/bootstrap nameservers. Matcher/trie policies, proxy-server policies and direct-follow-policy reuse are included in the regression scope.
- `dns/resolver.go` joins the exact-source adapter and native build provenance checks. Historical packaged native-library hashes and upstream/dependency versions are not changed or automatically approved.
- This is not a new Android stop operation or complete DNS/provider shutdown. In-flight queries can remain active or reopen transports; provider health checks/fetchers, comprehensive non-TUN generation isolation and no-loss immediate restart remain separate work. The two-second ordinary setup drain and all packaging, licensing, distribution and physical-device acceptance gates remain unchanged. Current-revision test/CI results are recorded in PR #133; no merge or release is authorized here.
