<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus logo" width="190">
</p>

<h1 align="center">AngelaNexus</h1>

<p align="center">智能网络代理平台</p>

AngelaNexus is the unified cross-platform proxy-system project for Mihomo, sing-box, and Xray adapters.

## Documentation languages

- **English (primary):** [`docs/README.md`](docs/README.md)
- **简体中文：** [`docs/zh-CN/README.md`](docs/zh-CN/README.md)

English is the normative documentation language. Chinese documentation mirrors the same architecture and product semantics.

## Constitutional architecture

The project's architecture, implementation, verification, and maintenance are governed by the **[AngelaNexus 底层宪级纲领](docs/ANGELANEXUS_CONSTITUTION.md)** (AN-Constitution v1.2). The constitution establishes Platform First, unified Intent and Policy semantics, Capability Registry and Driver Scheduler, parallel execution backends, canonical data models, protocol/transport separation, user control, security boundaries, strict resource-efficiency requirements, cross-platform isolation, evidence-based verification, and staged migration toward backend independence.

### Architecture and engineering principles

1. **Architecture:** Unified Intent + Policy + Capability Registry + Driver Scheduler.
2. **Execution backends:** Mihomo / sing-box / Xray remain parallel, standby-capable execution backends. The platform performs capability negotiation and adapter dispatch without tightly coupling the backends together.
3. **Intelligence:** Automatically identify configuration, protocol, transport, and capability requirements, then produce an explainable execution plan.
4. **User control:** Automation reduces operational complexity, while important network behavior remains inspectable, adjustable, and explicitly controllable by the user.
5. **Security:** Leak prevention, DNS, IPv4/IPv6, TUN, Kill Switch, privilege boundaries, and related security states must have explicit status and verification mechanisms.
6. **Performance:** Optimize for low latency, high throughput, and bounded concurrency while avoiding redundant parsing, matching, DNS work, connection establishment, and state maintenance.
7. **Resource efficiency:** Strictly control RAM, CPU, background wakeups, network-control overhead, and battery consumption. Unexplained or unacceptable resource regressions may block release progression.
8. **Cross-platform:** Android, Windows, macOS, Linux, and iOS share unified core semantics while using appropriate native platform capabilities through isolated adapters.
9. **Maintainability:** Use unified data models and Driver interfaces so that additional kernels, protocols, and execution backends do not create unnecessary architectural coupling.
10. **Verifiability:** Important design and implementation decisions must be supported by current upstream evidence, automated tests, measurable benchmarks, and regression verification.
11. **Long-term evolution:** After each homogeneous implementation stage, review the established constitutional principles before advancing, ensuring local feature work does not diverge from the overall architecture.

These principles are engineering requirements rather than marketing claims. See the constitution for the normative requirements, resource budgets, verification gates, and change-control rules.

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

See [docs/ANGELANEXUS_CONSTITUTION.md](docs/ANGELANEXUS_CONSTITUTION.md), [`docs/APP_PLATFORM_STRATEGY.md`](docs/APP_PLATFORM_STRATEGY.md), [`docs/APP_UI_DESIGN.md`](docs/APP_UI_DESIGN.md) and [`docs/APP_PROGRESS.md`](docs/APP_PROGRESS.md) for the project's architecture, UI design, progress and constitutional constraints.

## License

Original AngelaNexus source code is intended to be licensed under Apache License 2.0 unless a more specific file-level notice states otherwise. Third-party components retain their own licenses and attribution requirements. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`docs/legal/THIRD_PARTY_LICENSES.md`](docs/legal/THIRD_PARTY_LICENSES.md).

## Acknowledgements

AngelaNexus builds on open-source software, upstream proxy projects, standards, developer tools, and community knowledge. See [`docs/ACKNOWLEDGEMENTS.md`](docs/ACKNOWLEDGEMENTS.md) for the current acknowledgement list and attribution principles.
