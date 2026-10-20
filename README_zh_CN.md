# AngelaNexus

<p align="center">
  <img src="assets/brand/angelanexus-logo.svg" alt="AngelaNexus" width="190">
</p>

<p align="center"><strong>智能网络代理平台</strong></p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="docs/zh-CN/README.md">中文文档</a> ·
  <a href="docs/ANGELANEXUS_CONSTITUTION.md">底层宪级纲领</a>
</p>

> 面向 Android、iOS、Windows、macOS、Linux 的智能网络代理平台，以统一策略、能力协商、可替换执行 Driver、安全验证和可测量的资源效率为基础。

## 核心能力

- **全平台** — Android、iOS、Windows、macOS、Linux。
- **三内核执行体系** — Mihomo、sing-box、Xray 作为平行、可协商能力的执行 Driver。
- **统一架构** — Intent + Policy + Capability Registry + Driver Scheduler。
- **自动识别** — 自动识别配置、协议、传输和能力需求，并形成可解释的执行计划。
- **用户控制** — 自动化降低操作门槛，重要网络行为仍可查看、调整和固定。
- **安全优先** — 防泄漏、DNS、IPv4/IPv6、TUN、Kill Switch、权限边界等均要求明确状态和验证机制。
- **高效率低耗能** — 严格控制 RAM、CPU、后台唤醒、电池消耗和网络控制开销。
- **可持续维护** — 使用统一数据模型和 Driver 接口，避免新增协议或执行后端造成不必要的架构耦合。
- **可验证** — 重要设计和实现必须有最新可信的上游依据、自动化测试、基准测试和回归验证。

## 平台架构

```
                         AngelaNexus
                              │
                ┌─────────────▼─────────────┐
                │ 平台控制面                 │
                │ Intent · Policy · 路由     │
                │ DNS · 安全 · 生命周期      │
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
                         协议 / 传输
                              │
                            网络
```

三个执行后端彼此不直接绑定。平台根据当前 Intent、所需能力、用户策略、平台限制和已验证的 Driver 状态，选择获得授权且适配的执行 Driver。

## 支持平台

| 平台 | 定位 | 状态 |
|---|---|---|
| Android | 第一执行应用载体 | 开发中 |
| iOS | 全平台目标 | 按里程碑推进 |
| Windows | 全平台目标 | 按里程碑推进 |
| macOS | 全平台目标 | 按里程碑推进 |
| Linux | 全平台目标 | 按里程碑推进 |

Android 是当前第一执行应用载体，不是架构上的主平台。

## 发行阶段

AngelaNexus **不会一开始就直接发行 Stable / 正式版**。

计划发行路线：

```
开发版
  ↓
Alpha / 实验版
  ↓
Preview / 预览版
  ↓
Beta / 测试版
  ↓
Release Candidate / 候选版
  ↓
Stable / 正式版
```

当前 Android APP 基线版本为 **0.1.0**，明确属于非正式开发阶段。

CI 全绿、APK/AAB 已签名或开发版本能够运行，都不能单独证明已经达到正式版标准。

进入 Stable 前，需要逐步建立核心功能、真实设备、三内核一致性、网络安全、资源效率、升级迁移、发布产物和已知限制等方面的充分验证证据。

详见 [发布策略](docs/RELEASE_POLICY.md)。

## 当前状态

- 平台无关核心：开发中。
- 统一 Driver Scheduler 与能力匹配：开发中。
- Android APP 模块：位于 `native/android/app`。
- Android VPN 边界：已接入原生 `VpnService`。
- Android 配置导入：已实现有界 UTF-8 读取、版本化导入和内核无关的处理链路。
- Android Root / 透明网络：能力与受控运行时基础已经建立；正式能力必须经过真实设备和真实内核验证。
- Mihomo / sing-box / Xray 实际运行时嵌入：尚不宣称达到生产就绪。

## 本地开发与验证

需要 Node.js 20 或更新版本；CI 使用 Node.js 24。

```sh
npm ci
npm run verify               # JS / JSON / YAML 语法与完整自动化测试
npm run core:android:bundle  # 重新生成 Android 内嵌 Core
npm run benchmark:smoke      # 小规模功能基准，不代表真机性能
```

本地 Core 导入服务通过 `npm run core:server` 启动，默认监听
`127.0.0.1:18181`，接口为 `POST /v1/runtime/import`。
这是开发用的无认证 HTTP 接口，不要直接暴露到公网或不可信网络。
端口和监听地址可通过 `ANGELANEXUS_CORE_PORT`、`ANGELANEXUS_CORE_HOST` 设置。

`importSource(source, { kernel, prepareRuntimeHandoff: true })` 可为文本、
本地文件内容、URL 和结构化配置准备运行时交接数据；编译不等于启动内核。
分享链接需要明确可兼容的内核绑定后才能生成交接配置。

URL 订阅下载默认限制为 5 MiB、30 秒（覆盖重定向和响应体），严格校验 UTF-8。
`importSource` 与 `importConfigurationAsync` 均可接收 `maxBytes`、`timeoutMs`
及 `signal: abortController.signal`，以显式限制或取消下载。

三内核真实流量验收使用 `npm run kernel:traffic:test`，需显式设置
`NEXUS_MIHOMO_BIN`、`NEXUS_SING_BOX_BIN`、`NEXUS_XRAY_BIN` 为已验证的可执行文件。
测试覆盖本地 HTTP/SOCKS 转发和上游拒绝时不得直连；不修改系统网络，也不等于真机
TUN、DNS/IPv6 防泄漏或加密协议互通验证。自定义 text-only fetcher 的字节检查发生在
文本读取之后；此类受信任适配器需自行限制内存并响应取消。

Android 完整构建还需要 Android SDK、Gradle 8.10.2，以及 CI 固定版本的原生
AAR / 库。仓库当前没有 Gradle Wrapper，不能直接运行 `./gradlew`。
原生依赖准备、单元测试、APK 打包和模拟器验证步骤见
[Android 构建工作流](.github/workflows/android-build.yml)。
通过 Core 测试或模拟器测试，不代表已完成真机 TUN、泄漏防护或电池验证。

已启动并解锁的测试设备可运行
`ADB=/path/to/adb APK=/path/to/app.apk node scripts/android-runtime-smoke.mjs`。
此命令会安装/替换测试包并强制停止现有进程；仅在专用测试设备执行。
验收要求安装与启动明确成功、同一进程持续存活 30 秒且 MainActivity 位于前台；
失败时返回非零退出码，不以旧包仍在运行或后台 Activity 记录作为成功证据。
构建流程保留调试 APK、JUnit XML 和可用的模拟器/logcat/Activity 日志，
独立无 GMS 冒烟流程也会在失败时保留诊断并将检查标红。

## 文档

- [English README](README.md)
- [中文文档](docs/zh-CN/README.md)
- [底层宪级纲领](docs/ANGELANEXUS_CONSTITUTION.md)
- [发布策略](docs/RELEASE_POLICY.md)
- [平台架构](docs/PLATFORM_ARCHITECTURE.md)
- [产品体验基线](docs/PRODUCT_EXPERIENCE_BASELINE.md)
- [项目进度](docs/APP_PROGRESS.md)

## 工程硬约束

1. 安全和正确性优先于效率与省电优化。
2. 自动优化不得静默改变用户明确设置的网络策略。
3. 三内核“待命”表示能力可用和可调度，不表示三个完整运行时必须长期常驻。
4. 所有后台工作必须有边界、可解释，并通过资源审计。
5. 资源回归必须实测、处理或明确论证后，才能进入后续阶段。
6. 每完成一个同质类实现阶段，都必须回顾并审计既定纲领，再进入下一阶段。

规范性要求以 [AN-Constitution](docs/ANGELANEXUS_CONSTITUTION.md) 为准。

## 许可

AngelaNexus 原创代码计划采用 Apache License 2.0，除非具体文件另有更明确的许可声明。

第三方组件保留其各自的许可证和署名要求。

详见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和 [第三方许可证](docs/legal/THIRD_PARTY_LICENSES.md)。

## 致谢

AngelaNexus 使用了开源软件、上游项目、标准、开发工具和社区知识。第三方署名统一维护在 [ACKNOWLEDGEMENTS](docs/ACKNOWLEDGEMENTS.md)。
