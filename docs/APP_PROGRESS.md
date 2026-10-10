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
- Launcher `MainActivity` and AngelaNexus brand mark in the application UI and launcher icon.
- Native Android `VpnService` boundary wired into the application manifest.
- Android document picker entry point for local configuration-file import.
- State-aware VPN start/stop controls with explicit unsupported-plan and cleanup-failure feedback.
- Dedicated Android debug-build CI workflow.

### Android configuration import path

Implemented and tested:

- bounded UTF-8 reading with the 5 MiB input limit;
- versioned Android import DTO and serialized envelope;
- Android transport boundary that sends only the serialized envelope;
- platform-neutral runtime receiver that validates envelope type, version, source, name and byte limit;
- Core import runtime handoff into the existing kernel-neutral import pipeline;
- regression coverage for valid envelopes and malformed/oversized input;
- The existing Android local-file import path is verified. Manual HTTPS subscription import is now implemented in PR #114 and awaits Android CI; single-node links remain unavailable.

This milestone establishes the import and handoff contracts. A separate Android-only encrypted local Profile MVP is now implemented and CI-verified; this does not claim that every valid Core intent is executable or that profiles sync across devices.

### Android encrypted local Profiles MVP

Implemented and verified by GitHub Actions for PR #114 commit `04da7d6`:

- Explicit local save, list, select, rename and confirmed delete for up to 20 profiles, with a 5 MiB configuration limit per profile.
- Profile names, active index and configuration bodies use AES-GCM authenticated encryption with a non-exportable Android Keystore AES-256 key; ciphertext is stored in `noBackupFilesDir` and is not uploaded, synced or included in device backup.
- Startup restoration and every profile selection re-enter the Core import/validation pipeline. A failed or unavailable key, corrupt ciphertext or invalid Core result does not silently reset or start a profile.
- Profile mutations, imports and VPN start are serialized; profile changes are blocked while VPN execution or cleanup is active.
- JVM regression tests cover CRUD, limits, tampering, corrupt indexes and plaintext absence. One emulator instrumentation test verifies non-exportable Keystore key material, persistence, AES-GCM tamper rejection and CRUD.
- The complete PR check set finished with 23 successful, 1 conditionally skipped and 0 failed checks. See [PR #114](https://github.com/angelacoke/AngelaNexus/pull/114) and the [Android build run](https://github.com/angelacoke/AngelaNexus/actions/runs/38020683132).

This is Android device-local persistence, not account/cloud synchronization or backup. It has not received an independent security audit and does not establish physical-device networking behavior.

### Android transparent/root networking baseline

Implemented and tested at the contract/integration level:

- transparent mode selection;
- guarded rooted backend capability checks;
- atomic rule transaction boundaries;
- self-loop protection;
- cleanup and rollback handling;
- live transparent runtime inspection and health checks.

Real-device traffic interception remains a separate verification requirement and is not marked complete without reproducible device evidence.

### Android execution-state bridge and launch gate

Implemented in source with regression coverage:

- stable kernel-neutral execution phases from import receipt through start, running, stop and failure;
- process-wide `StateFlow` publication so the VPN service reports lifecycle facts and the UI observes them;
- complete Core handoff validation: selected kernel, configuration and canonical routing execution intent are all required;
- launch gate restricted to the currently executable `proxy` mode and a registered Android driver (`mihomo`, `sing-box` or `xray`); valid `direct`, `reject`, `chain` and `dns` intents remain inspectable but cannot be started or silently reinterpreted as proxy;
- one-shot, in-memory handoff token; the configuration is not placed in the Android service Intent or written as a plaintext handoff cache;
- verified-stop requirement: if native cleanup fails, the UI stays fail-closed and offers a cleanup retry instead of allowing reconnection;
- regression coverage for lifecycle transitions, cleanup failure, supported/unsupported intents and one-shot token consumption.

The Android CI workflow runs JVM unit tests, assembles a debug APK, and installs/launches the app in an Android emulator. The smoke test proves that the APK and launcher activity start and the process remains alive; it does **not** prove physical-device TUN traffic or successful end-to-end proxying. See [PR #114](https://github.com/angelacoke/AngelaNexus/pull/114) for the current implementation and checks.

### Android Mihomo native runtime boundary

Implemented and CI-verified:

- Mihomo source pinned to exact release `v1.19.32` commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`;
- Android native shared-library build verification for `arm64-v8a`, `armeabi-v7a` and `x86_64`;
- Go 1.24.8 and Android NDK 28.0.13004108 pinned in the verification workflow;
- reproducible `c-shared` build with version metadata pinned to `v1.19.32`;
- SHA-256-pinned native artifacts for all three supported ABIs;
- verified JNI loading boundary that refuses missing or hash-mismatched native artifacts;
- a dedicated Android packaging workflow exists and requires approved distribution, license, provenance and naming gates before embedding Mihomo;
- the current compliance manifest still marks distribution `blocked` and all three reviews `required`; the latest main-branch run skipped the release-package job and uploaded no APK/AAB.

The per-ABI native libraries are build-verified CI artifacts, **not** an approved Android app distribution. The normal Android build keeps a dedicated Mihomo approval flag false; only the release-package job behind the compliance gate passes that flag, and runtime availability also checks the installed library's pinned SHA-256. PR #114 commit `0bc64db` passed CI (23 successful checks, 1 skipped, 0 failed/pending), including Android unit tests, Debug APK assembly, emulator smoke, and one connected instrumentation test. No physical-device TUN or end-to-end proxy traffic is claimed.

### Modern modular UI baseline

Implemented on Android as the first platform surface:

- Jetpack Compose + Material 3 foundation.
- System light/dark theme support and Android dynamic colors.
- Five-module navigation: Home / Profiles / Proxies / Rules / Settings.
- Home connection controls and runtime phase are driven by the Android service state, not by fabricated traffic values.
- Profiles shows Core import results and explicit-save, device-local encrypted profile management; configuration input remains local-file-only and is not cloud-synced.
- Proxies shows Core-detected node count, kernel binding and up to 100 bounded, credential-free node summaries (name, protocol, server and port). A truncated preview is identified explicitly; summaries are read-only and do not provide live proxy selection.
- The Android parser enforces the exact summary-field allowlist, string bounds, item cap and truncation consistency. The Node suite (1,015 tests) and Android Core bundle build pass locally. PR #114 commit `4571b2e` passed GitHub Actions with 18 successful checks, 1 skipped and 0 failed, including Android JVM tests, Debug APK assembly and emulator smoke.
- Compose observes the process-wide runtime `StateFlow` with lifecycle-aware collection and resumes from its current value when the Activity returns to the foreground. This does not auto-start or reconnect the VPN; physical-device background, Doze and network-transition behavior remain unverified.
- The upstream sync check now handles GitHub's bounded compare-file response and passes; no production kernel pin was changed (`sing-box` remains `1.14.2`).
- Rules shows a parsed Core routing-intent preview for inspection only; it does not claim the intent is active or that effective runtime rules have been reported.
- Traffic, effective routing, anti-leak and GFW status are explicitly labeled unreported or unverified unless the active runtime supplies evidence.
- The Android shell keeps bottom navigation in compact windows and switches to a labeled Material 3 navigation rail at 600 dp or wider; the selected destination survives Activity recreation. The breakpoint has JVM regression coverage.
- Tablet/desktop content adaptation beyond the navigation shell remains pending.
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

## Not yet claimed as production functionality

- Physical-device TUN establishment and end-to-end proxy traffic interception are not yet verified. The emulator smoke test only launches the app; it does not exercise VPN consent, TUN setup, or real traffic.
- The new one-shot HTTPS subscription path in PR #114 is pending CI. Single-node links, live proxy selection, effective runtime rules, live traffic counters and verified DNS/IPv6/leak status remain unavailable. Node summaries are an import preview, not live runtime state.
- Android encrypted local Profiles are implemented and emulator-verified, but there is no account sync, profile export/backup, cross-device conflict/recovery or independent security audit.
- The UI observes Android VPN lifecycle phases, but it is not yet backed by a complete Core execution/telemetry stream.
- Active VPN session recovery after process/device restart, background and battery behavior remain unverified; saved Profile restoration does not auto-start the VPN, and a foreground-service notification channel is not proof of production lifecycle readiness.
- Production cloud authentication/storage/sync service is not yet implemented.
- iOS, Windows, macOS and Linux executable application shells are not yet claimed as implemented.

## Cross-platform APP milestones

1. Establish shared UI/state contracts across all target platforms.
2. Establish account/sync/backup contracts and security boundaries. **Done at Core contract level.**
3. Extract reusable UI into the multiplatform UI layer without leaking platform APIs.
4. Implement account authentication and cloud data service behind a platform-neutral service contract.
5. Connect Android local and HTTPS subscription imports to the kernel-neutral pipeline. **Local files are verified; one-shot HTTPS import is in PR #114 and awaits CI.**
6. Implement Android lifecycle controls and a validated Core-to-VPN handoff. **Source and regression coverage are in PR #114; automated CI verifies Android tests, debug APK launch and pinned native-kernel builds. Physical-device TUN and traffic verification remains.**
7. Add Android-only encrypted local Profile persistence with Core revalidation. **Implemented and CI-verified in PR #114; cloud sync and device backup remain out of scope.**
8. Establish Desktop JVM application shell shared by Windows/macOS/Linux.
9. Establish iOS application entry point and Network Extension boundary.
10. Add platform-specific secure storage, background lifecycle, notifications, network state and resource-policy adapters.
11. Integrate Mihomo/sing-box/Xray per platform only after adapter-level verification.
12. Add device/OS regression verification and release packaging for every target.

## Evidence rule

A milestone is marked implemented only after source-level evidence plus reproducible build/test evidence exists. Platform placeholders remain explicitly labeled until exercised.
