# AngelaNexus

<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus" width="190">
</p>

<p align="center"><strong>智能网络代理平台</strong></p>

<p align="center">
  <a href="README_zh_CN.md">简体中文</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/ANGELANEXUS_CONSTITUTION.md">Constitution</a>
</p>

> A cross-platform network proxy platform built around unified policy, capability negotiation, replaceable execution Drivers, security verification, and measurable resource efficiency.

## Features

- **Cross-platform** — Android, iOS, Windows, macOS, and Linux.
- **Three execution backends** — Mihomo, sing-box, and Xray participate as parallel, capability-aware Drivers.
- **Unified architecture** — Intent + Policy + Capability Registry + Driver Scheduler.
- **Automatic recognition** — Detect configuration, protocol, transport, and capability requirements, then build an explainable execution plan.
- **User control** — Automation lowers complexity; important network behavior remains visible, adjustable, and lockable by the user.
- **Security-first** — Explicit security state and verification for leak prevention, DNS, IPv4/IPv6, TUN, Kill Switch, privilege boundaries, and related controls.
- **Efficient operation** — Avoid redundant parsing, matching, DNS work, connections, state, background wakeups, and control traffic.
- **Low resource usage** — RAM, CPU, wakeups, and battery consumption are treated as architectural constraints, not late-stage optimizations.
- **Maintainable by design** — Canonical data models and Driver interfaces keep new protocols and execution backends from creating unnecessary coupling.
- **Evidence-based development** — Important behavior is backed by current upstream evidence, automated tests, benchmarks, and regression verification.

## Architecture

```
                         AngelaNexus
                              │
                ┌─────────────▼─────────────┐
                │ Platform Control Plane    │
                │ Intent · Policy · Routing │
                │ DNS · Security · Lifecycle│
                └─────────────┬─────────────┘
                              │
                Capability Registry
                              │
                    Driver Scheduler
                  ┌───────────┼───────────┐
                  ▼           ▼           ▼
               Mihomo      sing-box      Xray
                  │           │           │
                  └───────────┼───────────┘
                              ▼
                    Protocol / Transport
                              │
                           Network
```

The three backends are not coupled to one another. AngelaNexus selects an authorized Driver according to the current Intent, required capabilities, user policy, platform constraints, and verified Driver state.

## Platforms

| Platform | Direction | Status |
|---|---|---|
| Android | First executable application surface | Active development |
| iOS | Cross-platform target | Milestone-driven |
| Windows | Cross-platform target | Milestone-driven |
| macOS | Cross-platform target | Milestone-driven |
| Linux | Cross-platform target | Milestone-driven |

Android is the first executable application surface, not the architectural primary target.

## Release status

AngelaNexus **does not start as a Stable / formal release**.

Planned lifecycle:

```
Development
    ↓
Alpha / Experimental
    ↓
Preview
    ↓
Beta
    ↓
Release Candidate
    ↓
Stable
```

The current Android application baseline is **0.1.0**, explicitly a pre-release/development version.

A successful CI run, a signed APK/AAB, or a functioning development build does not by itself establish production readiness.

Before Stable, the project must accumulate evidence for core functionality, real-device behavior, three-kernel conformance, network security, resource usage, upgrade/migration safety, release artifacts, and known limitations.

See [Release Policy](docs/RELEASE_POLICY.md).

## Current status

- Platform-neutral core: active development.
- Unified Driver Scheduler and capability matching: active development.
- Android application module: present under `native/android/app`.
- Android VPN boundary: native `VpnService` integration is present.
- Android configuration import pipeline: implemented with bounded UTF-8 reading and kernel-neutral handoff.
- Android root/transparent networking: capability and guarded-runtime foundations are present; production claims require real-device/kernel verification.
- Mihomo / sing-box / Xray runtime embedding: not yet claimed as production-ready.

## Documentation

- [English documentation](docs/README.md)
- [简体中文文档](docs/zh-CN/README.md)
- [Constitution](docs/ANGELANEXUS_CONSTITUTION.md)
- [Release Policy](docs/RELEASE_POLICY.md)
- [Platform Architecture](docs/PLATFORM_ARCHITECTURE.md)
- [Product Experience Baseline](docs/PRODUCT_EXPERIENCE_BASELINE.md)
- [Project Progress](docs/APP_PROGRESS.md)

## Development principles

The project's constitutional requirements include:

1. Security and correctness precede efficiency and power optimization.
2. User policy must not be silently changed by automatic optimization.
3. Three-kernel standby means capability availability, not three full runtimes permanently resident.
4. Background work must be bounded, explainable, and resource-audited.
5. Resource regressions must be measured and resolved or explicitly justified before progression.
6. Each homogeneous implementation stage is audited against the established constitution before the next stage begins.

The normative requirements are defined in [AN-Constitution](docs/ANGELANEXUS_CONSTITUTION.md).

## License

AngelaNexus original source code is intended to use Apache License 2.0 unless a more specific file-level notice states otherwise.

Third-party components retain their own licenses and attribution requirements.

See [LICENSE](LICENSE), [NOTICE](NOTICE), and [Third-party licenses](docs/legal/THIRD_PARTY_LICENSES.md).

## Acknowledgements

AngelaNexus uses open-source software, upstream projects, standards, developer tools, and community knowledge. Third-party attribution is maintained separately in [ACKNOWLEDGEMENTS](docs/ACKNOWLEDGEMENTS.md).
