<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus logo" width="190">
</p>

<h1 align="center">AngelaNexus</h1>

<p align="center">智能网络代理平台</p>

> **Release status / 发布状态：非正式版本阶段（Pre-release）**
>
> AngelaNexus APP will begin distribution through pre-release channels such as Alpha / Preview / Beta. **Stable / 正式版 will not be declared at the beginning.** Stable release requires the project's defined security, compatibility, performance, resource-efficiency, device verification, and regression gates to be satisfied.

---

## 中文简介

AngelaNexus 是面向 **Android、iOS、Windows、macOS、Linux** 的智能网络代理平台，采用统一平台控制面与可替换执行 Driver 架构。

核心架构为：

**Unified Intent + Policy + Capability Registry + Driver Scheduler**

Mihomo、sing-box、Xray 作为平行执行后端参与能力协商和实际协议/传输执行。平台负责统一意图、策略、能力匹配、调度、安全边界和用户控制，不要求用户直接理解不同内核之间的实现差异。

### 核心工程原则

1. **架构**：统一 Intent + Policy + Capability Registry + Driver Scheduler。
2. **内核**：Mihomo / sing-box / Xray 平行待命、能力协商、适配执行，不互相绑死。
3. **智能**：自动识别配置、协议、传输和能力，自动形成可解释的执行计划。
4. **用户控制**：自动化负责降低操作门槛，但重要网络行为始终可以查看、调整和固定。
5. **安全**：防泄漏、DNS、IPv4/IPv6、TUN、Kill Switch、权限边界等必须具有明确状态和验证机制。
6. **性能**：低延迟、高吞吐、合理并发，避免重复解析、重复匹配、重复连接和重复状态维护。
7. **资源**：严格控制 RAM、CPU、后台唤醒、网络控制开销和电池消耗；不可接受的资源回归可以阻断发布。
8. **跨平台**：Android、Windows、macOS、Linux、iOS 保持统一核心语义，同时通过隔离的 Platform Adapter 使用各系统原生能力。
9. **可维护性**：统一数据模型和 Driver 接口，避免增加内核或协议时形成不必要的架构耦合。
10. **可验证性**：重要设计必须有最新可信的上游依据、自动化测试、可测量基准和回归验证。
11. **长期演进**：每完成一个同质类实现阶段，都回顾并审计既定纲领，确认局部实现没有偏离整体架构。

这些原则是工程要求，而不是营销宣传。规范性要求以 [AngelaNexus 底层宪级纲领](docs/ANGELANEXUS_CONSTITUTION.md) 为准。

## English summary

AngelaNexus is a unified cross-platform proxy-system project for **Android, iOS, Windows, macOS, and Linux**.

Its architecture is based on:

**Unified Intent + Policy + Capability Registry + Driver Scheduler**

Mihomo, sing-box, and Xray operate as parallel execution backends. The platform owns unified intent, policy, capability matching, scheduling, security boundaries, and user control, while each Driver preserves the backend's native protocol and transport capabilities.

The project prioritizes security, correctness, user control, performance, low memory usage, low background activity, low battery consumption, cross-platform consistency, maintainability, measurable verification, and constitutional review during staged implementation.

## Release policy / 发布策略

AngelaNexus APP **不会直接以 Stable / 正式版起步**。

Planned lifecycle:

```text
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
Stable / 正式版
```

The exact channel for each distributed build will be explicitly identified. A pre-release build must not be described as a Stable / 正式版, and production-readiness claims must not be inferred merely from a successful CI build or a signed APK/AAB.

Before Stable, the project must establish sufficient evidence for at least:

- core functionality and regression stability
- real-device verification
- cross-platform verification appropriate to the supported surface
- three-kernel capability and execution conformance
- network security and leak-prevention verification
- resource, memory, CPU, wakeup, and battery measurements
- upgrade / rollback and configuration migration safety
- signing and release-artifact verification
- documented known limitations and release criteria

## Product platforms

AngelaNexus is designed for all five primary platforms from the architecture layer:

- Android
- iOS
- Windows
- macOS
- Linux

Android is currently the first executable application surface, not the architectural primary target.

## Current implementation status

- Platform-neutral core: active development with automated unit and three-kernel conformance verification.
- Cross-platform UI strategy: shared UI semantics with independent native platform capability adapters.
- Android: real application module baseline is present under `native/android/app`.
- Current Android application version baseline: `0.1.0`, explicitly a **pre-release/development version**, not Stable.
- Android VPN: native `VpnService` boundary is wired into the application shell.
- Android configuration import: document picker, bounded UTF-8 reader, versioned import envelope, Core receiver, and kernel-neutral import pipeline handoff are implemented and covered by tests.
- Android transparent/root networking: capability contracts, guarded rule transactions, lifecycle cleanup, and runtime health checks are implemented; real device/kernel execution remains separately verified before being claimed as production-complete.
- iOS / Windows / macOS / Linux executable shells: architectural targets established; implementation remains milestone-driven and is not claimed as complete.
- Mihomo / sing-box / Xray Android runtime embedding: not yet claimed as production-ready.

## Documentation / 文档

- **English documentation:** [`docs/README.md`](docs/README.md)
- **简体中文文档：** [`docs/zh-CN/README.md`](docs/zh-CN/README.md)
- **底层宪级纲领 / Constitution:** [`docs/ANGELANEXUS_CONSTITUTION.md`](docs/ANGELANEXUS_CONSTITUTION.md)
- **Release policy / 发布策略:** [`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)

## Project identity

The four-quadrant cross mark in `assets/brand/angelanexus-logo.svg` is the official project logo. The square variant in `assets/brand/angelanexus-app-icon.svg` is the canonical app-icon asset for platform clients.

## License

Original AngelaNexus source code is intended to be licensed under Apache License 2.0 unless a more specific file-level notice states otherwise. Third-party components retain their own licenses and attribution requirements. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`docs/legal/THIRD_PARTY_LICENSES.md`](docs/legal/THIRD_PARTY_LICENSES.md).

## Acknowledgements

AngelaNexus builds on open-source software, upstream proxy projects, standards, developer tools, and community knowledge. See [`docs/ACKNOWLEDGEMENTS.md`](docs/ACKNOWLEDGEMENTS.md) for the current acknowledgement list and attribution principles.
