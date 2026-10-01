<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus logo" width="190">
</p>

<h1 align="center">AngelaNexus</h1>

<p align="center">智能网络代理平台</p>

AngelaNexus is the unified cross-platform proxy-system project for Mihomo, sing-box, and Xray adapters.

## Product platforms

AngelaNexus APP is designed for all five primary platforms from the first architecture layer:

- Android
- iOS
- Windows
- macOS
- Linux

Android is currently the first executable application surface, not the architectural primary target.

## Project identity

The four-quadrant cross mark in `assets/brand/angelanexus-logo.svg` is the official project logo. The square variant in `assets/brand/angelanexus-app-icon.svg` is the canonical app-icon asset for platform clients.

## Current implementation status

- Platform-neutral core: active development with automated unit and three-kernel conformance verification.
- Cross-platform UI strategy: shared UI semantics with independent native platform capability adapters.
- Android: real application module baseline is present under `native/android/app`.
- Android VPN: native `VpnService` boundary is wired into the application shell.
- Android configuration import: document picker, bounded UTF-8 reader, versioned import envelope, Core receiver, and kernel-neutral import pipeline handoff are implemented and covered by tests.
- Android transparent/root networking: capability contracts, guarded rule transactions, lifecycle cleanup, and runtime health checks are implemented; real device/kernel execution remains separately verified before being claimed as production-complete.
- iOS / Windows / macOS / Linux executable shells: architectural targets established; implementation remains milestone-driven and is not claimed as complete.
- Mihomo / sing-box / Xray Android runtime embedding: not yet claimed as production-ready.

See [`docs/APP_PLATFORM_STRATEGY.md`](docs/APP_PLATFORM_STRATEGY.md), [`docs/APP_UI_DESIGN.md`](docs/APP_UI_DESIGN.md) and [`docs/APP_PROGRESS.md`](docs/APP_PROGRESS.md) for the evidence-based APP architecture, UI design and progress.

## License

Original AngelaNexus source code is intended to be licensed under Apache License 2.0 unless a more specific file-level notice states otherwise. Third-party components retain their own licenses and attribution requirements. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`docs/legal/THIRD_PARTY_LICENSES.md`](docs/legal/THIRD_PARTY_LICENSES.md).

## Acknowledgements

AngelaNexus builds on open-source software, upstream proxy projects, standards, developer tools, and community knowledge. See [`docs/ACKNOWLEDGEMENTS.md`](docs/ACKNOWLEDGEMENTS.md) for the current acknowledgement list and attribution principles.
