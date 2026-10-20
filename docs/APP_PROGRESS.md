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
