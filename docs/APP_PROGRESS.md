# AngelaNexus APP Progress

## Baseline verified

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

Implemented:

- Jetpack Compose + Material 3 foundation.
- System light/dark theme support and Android dynamic colors.
- Five-module bottom navigation: Home / Profiles / Proxies / Rules / Settings.
- Compact card-based dashboard inspired by modern Clash clients while keeping AngelaNexus-specific information architecture.
- Explicit Core, VPN, routing, anti-leak and GFW status surfaces.
- Responsive semantic component structure intended for phone/tablet/desktop adaptation.
- UI design specification in `docs/APP_UI_DESIGN.md`.

The UI reference direction is based on documented FlClash characteristics such as Material You, adaptive screen sizes, multiple color themes and separated proxy/profile/settings experiences. AngelaNexus does not copy FlClash implementation or architecture.

Not yet claimed as production functionality:

- No Mihomo/sing-box/Xray runtime is embedded in the Android APK yet.
- Configuration import currently reaches the Android document-picker boundary; the selected input is not yet connected to the core import pipeline.
- VPN boundary establishment is only a platform integration check; it does not install a proxy route or claim traffic interception.
- The UI is not yet backed by the full Core execution state stream.
- No production Android background lifecycle, notification channel, secure storage, or battery policy integration is claimed yet.

## Next APP milestones

1. Connect Android configuration import to the existing kernel-neutral import pipeline through a platform bridge.
2. Add a typed Android application-state model backed by the core execution controller.
3. Connect user-visible start/stop state to the core execution lifecycle without duplicating kernel policy in Android code.
4. Integrate one verified kernel runtime on Android behind the existing adapter contract.
5. Add Android secure storage, foreground-service lifecycle, notification, network-state and resource-policy adapters.
6. Add device-level regression/build verification before claiming a production Android release.
7. Repeat the same contract-driven implementation for Apple, Windows, macOS and Linux.

## Evidence rule

A milestone is marked implemented only after source-level evidence plus reproducible build/test evidence exists. Platform placeholders remain explicitly labeled until exercised.
