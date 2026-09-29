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

### Modern modular UI baseline

Implemented on Android as the first platform surface:

- Jetpack Compose + Material 3 foundation.
- System light/dark theme support and Android dynamic colors.
- Five-module navigation: Home / Profiles / Proxies / Rules / Settings.
- Compact card-based dashboard inspired by modern Clash clients while keeping AngelaNexus-specific information architecture.
- Explicit Core, VPN, routing, anti-leak and GFW status surfaces.
- Responsive semantic component structure intended for phone/tablet/desktop adaptation.
- UI design specification in `docs/APP_UI_DESIGN.md`.

The long-term UI implementation will move common semantics and reusable UI into the shared multiplatform layer. Android-only APIs remain in the Android shell.

## Not yet claimed as production functionality

- No Mihomo/sing-box/Xray runtime is embedded in the Android APK yet.
- Configuration import currently reaches the Android document-picker boundary; the selected input is not yet connected to the core import pipeline.
- VPN boundary establishment is only a platform integration check; it does not install a proxy route or claim traffic interception.
- The UI is not yet backed by the full Core execution state stream.
- No production Android background lifecycle, notification channel, secure storage, or battery policy integration is claimed yet.
- iOS, Windows, macOS and Linux executable application shells are not yet claimed as implemented.

## Cross-platform APP milestones

1. Establish shared UI/state contracts across all target platforms.
2. Extract reusable UI into the multiplatform UI layer without leaking platform APIs.
3. Connect Android configuration import to the kernel-neutral import pipeline.
4. Complete Android execution-state bridge and one verified kernel runtime.
5. Establish Desktop JVM application shell shared by Windows/macOS/Linux.
6. Establish iOS application entry point and Network Extension boundary.
7. Add platform-specific secure storage, background lifecycle, notifications, network state and resource-policy adapters.
8. Integrate Mihomo/sing-box/Xray per platform only after adapter-level verification.
9. Add device/OS regression verification and release packaging for every target.

## Evidence rule

A milestone is marked implemented only after source-level evidence plus reproducible build/test evidence exists. Platform placeholders remain explicitly labeled until exercised.
