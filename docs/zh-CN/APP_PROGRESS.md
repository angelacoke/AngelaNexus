# AngelaNexus 应用进度

## 产品范围

AngelaNexus 应用从架构基线起就是一个面向多平台的产品：

- Android
- iOS
- Windows
- macOS
- Linux

目前 Android 是第一个拥有可执行应用壳的目标平台，但它不是架构上的优先平台。

跨平台应用架构与能力边界见 `docs/APP_PLATFORM_STRATEGY.md`。

## 已验证的 Android 基线

仓库包含真正的 Android 应用模块，以及平台无关核心和原生 VPN 边界。

### Android 0.1.0 应用壳

已实现：

- 位于 `native/android/app` 的 Gradle Android 应用模块。
- `app.angelanexus` 应用命名空间和包名。
- 启动入口 `MainActivity`，以及应用界面和启动图标中的 AngelaNexus 品牌标识。
- 已在应用 Manifest 中声明并接入原生 Android `VpnService` 边界。
- 用于导入本地配置文件的 Android 文档选择器。
- 根据真实运行状态展示的 VPN 启动/停止控件，以及不支持方案和清理失败时的明确反馈。
- 专用 Android Debug 构建 CI 工作流。

### Android 配置导入路径

已实现并测试：

- 限制 5 MiB 输入大小的 UTF-8 读取；
- 版本化 Android 导入 DTO 和序列化 envelope；
- 仅传递序列化 envelope 的 Android transport 边界；
- 平台无关运行时接收端对 envelope 类型、版本、来源、名称和字节数的校验；
- Core 导入结果接入现有的内核无关导入流程；
- 对有效 envelope、格式错误和超限输入的回归测试；
- Android 本地文件与一次性 HTTPS 订阅导入已在 PR #114 代码提交 `11e6a8e` 通过 Android CI。单节点/分享链接和配置文本的手动粘贴导入已实现并进入 PR #114，等待 CI。

本阶段建立的是导入与 handoff 契约。另一个仅限 Android 的本机加密 Profile MVP 已实现并通过 CI 验证；这不代表每一种有效 Core 意图都能执行，也不代表档案已可跨设备同步。

### Android 本机加密 Profiles MVP

已在 PR #114 提交 `04da7d6` 通过 GitHub Actions 验证：

- 支持显式保存、列表查看、选择、重命名及二次确认删除；最多 20 个档案，每份配置上限 5 MiB。
- 档案名称、活动索引和配置正文以 AES-GCM 认证加密，并使用 Android Keystore 中不可导出的 AES-256 密钥；密文保存在 `noBackupFilesDir`，不会上传、同步或进入设备备份。
- 启动恢复与每次选择档案都会重新经过 Core 导入/校验。密钥不可用、密文损坏或 Core 校验失败时，不静默重置，也不会启动档案。
- 档案读写、导入与 VPN 启动按操作锁串行化；VPN 执行/清理期间禁止更改档案。
- JVM 回归测试覆盖 CRUD、容量限制、篡改/损坏索引及磁盘无明文；一项模拟器 instrumentation 测试验证 Keystore 密钥不可导出、持久化、AES-GCM 篡改拒绝与 CRUD。
- PR 全部检查结果：**23 项通过、1 项按条件跳过、0 项失败**。详见 [PR #114](https://github.com/angelacoke/AngelaNexus/pull/114) 和 [Android 构建运行](https://github.com/angelacoke/AngelaNexus/actions/runs/38020683132)。

这是 Android 本机持久化，不是账户/云端同步或备份；尚未进行独立安全审计，也不代表已验证真机网络功能。

### Android 透明/root 网络基线

已在契约/集成层实现并测试：

- 透明模式选择；
- 带守卫的 Root 后端能力检查；
- 原子化规则事务边界；
- 防止自身流量回环；
- 清理与回滚处理；
- 透明运行时实时检查和健康检查。

真机流量拦截仍是单独的验证要求；没有可复现的设备证据就不标记为完成。

### Android 执行状态桥与启动门槛

已在代码中实现并有回归测试：

- 从收到导入结果到启动、运行、停止和失败的稳定内核无关阶段；
- 进程级 `StateFlow`：VPN Service 发布生命周期事实，UI 观察该状态；
- 完整 Core handoff 校验：必须同时提供选定内核、配置和规范路由执行意图；
- 启动门槛仅允许当前 Android 已具备执行路径的 `proxy` 模式和已注册驱动（`mihomo`、`sing-box`、`xray`）；有效的 `direct`、`reject`、`chain` 和 `dns` 意图仍可供查看，但不可启动，也不会被静默改写成代理模式；
- 一次性进程内 handoff token：大配置不会放进 Android Service Intent，也不会写入明文临时缓存；
- 必须确认停止成功：原生清理失败时保持 fail-closed，禁止重连并向用户提供重试清理入口；
- 覆盖生命周期转换、清理失败、支持/不支持的意图以及一次性 token 消费的回归测试。

Android CI 会运行 JVM 单元测试、构建 Debug APK，并在 Android 模拟器中安装和启动应用。模拟器冒烟测试只证明 APK 与启动 Activity 可以运行且进程仍存活；它**不能**证明真机 TUN 流量或端到端代理可用。当前实现和检查见 [PR #114](https://github.com/angelacoke/AngelaNexus/pull/114)。

### Android Mihomo 原生运行时边界

已实现并通过 CI 验证：

- Mihomo 源码精确固定到 `v1.19.32`，提交为 `88dcbf7f1614a67c3b36b848ee3592dfa92ada36`；
- 对 `arm64-v8a`、`armeabi-v7a` 和 `x86_64` 三种 ABI 构建 Android 原生共享库并验证；
- 验证工作流固定 Go 1.24.8 和 Android NDK 28.0.13004108；
- 固定 `v1.19.32` 版本元数据的可复现 `c-shared` 构建；
- 三种受支持 ABI 均固定 SHA-256 的原生构建产物；
- JNI 加载边界会拒绝缺失或哈希不匹配的原生构建产物；
- 已建立专用 Android 打包工作流；只有分发、许可证、来源链和命名审查均获批准后，才会把 Mihomo 嵌入应用；
- 当前合规清单仍将分发标为 `blocked`，三项审查均为 `required`；最近一次 main 分支运行跳过正式打包 job，也没有上传 APK/AAB。

各 ABI 的 Mihomo 原生库是已验证的 CI 构建产物，**不等于获准分发的 Android 应用**。常规 Android 构建中的 Mihomo 审批位默认为 false；只有通过合规 gate 的正式打包 job 才会传入授权位，运行时还会校验安装包内库的 pinned SHA-256。PR #114 提交 `0bc64db` 已通过 CI（23 项通过、1 项跳过、0 项失败/待完成），包括 Android 单元测试、Debug APK 构建、模拟器冒烟和 1 项连接式 instrumentation test。尚未声称已在真机验证 TUN 或端到端代理流量。

### 现代模块化 UI 基线

Android 已实现第一版界面：

- Jetpack Compose + Material 3 基础界面。
- 跟随系统的浅色/深色主题及 Android 动态配色。
- 五个模块：首页 / 配置 / 代理 / 规则 / 设置。
- 首页连接控件和运行阶段由 Android Service 状态驱动，不虚构流量数值。
- 配置页展示 Core 导入结果并支持显式保存的本机加密档案；配置输入仍仅支持本地文件，也不会云同步。
- 代理页展示 Core 检出的节点数量、内核绑定，以及最多 100 条有界、无凭据节点摘要（名称、协议、服务器、端口）；会明确标出列表截断。摘要仅供查看，不提供实时代理选择。
- Android parser 严格校验摘要字段 allowlist、字符串长度、条目上限和截断标记一致性。Node 测试（1,015 项）和 Android Core bundle 本地构建已通过。PR #114 提交 `4571b2e` 的 GitHub Actions 已终结：18 项成功、1 项跳过、0 项失败；其中 Android JVM 测试、Debug APK 构建和模拟器冒烟均通过。
- Compose 通过生命周期感知收集观察进程级 runtime `StateFlow`，Activity 回到前台时从其当前值恢复观察；不会自动启动或重连 VPN。真实设备的后台、Doze 和网络切换行为仍未验证。
- 上游同步检查已按 GitHub compare 文件数量上限修正并通过；未改变生产内核 pin（sing-box 仍为 `1.14.2`）。
- 规则页只展示解析后的 Core 路由意图预览供检查；不会声称意图已经生效或运行时规则已回报。
- 只有活动运行时提供证据时才显示流量、实际路由、防泄漏和 GFW 状态；否则明确标记为“未回报”或“未验证”。
- 采用可适配手机/平板/桌面布局的语义化组件结构。
- UI 设计规范见 `docs/APP_UI_DESIGN.md`。

长期计划是将通用语义与可复用 UI 迁移到共享多平台层；Android 专属 API 仍留在 Android 壳中。

## 账户 / 云端 / 备份基线

已在 Core 契约层实现：

- 共享账户数据分类；
- 平台状态分离；
- 排除仅存于设备上的秘密；
- 账户快照模型；
- 快照合并契约；
- 备份 manifest 格式/版本契约；
- 拒绝设备凭据/秘密的备份校验；
- 覆盖这些边界的回归测试；
- 完整 UI/架构规范见 `docs/APP_ACCOUNT_SYNC.md`。

这是数据契约阶段，**不代表**云端账户服务或生产级云存储已经部署。

## 尚未宣称为生产功能

- 尚未在真机验证 TUN 建立和端到端代理流量拦截。模拟器冒烟测试只启动应用，不会实际走 VPN 授权、TUN 建立或真实流量。
- 一次性 HTTPS 订阅导入已在代码提交 `11e6a8e` 通过 Android CI。单节点/分享链接和配置文本的手动粘贴导入已进入 PR #114，等待 Android CI；实时代理选择、有效运行规则、实时流量统计及经验证的 DNS/IPv6/泄漏状态仍不可用。节点摘要只是导入预览，不是实时运行状态。
- Android 本机加密档案已实现并通过模拟器验证；账户同步、档案导出/备份、跨设备冲突/恢复和独立安全审计尚未实现。
- UI 能观察 Android VPN 生命周期阶段，但尚未接入完整的 Core 执行/遥测状态流。
- VPN 活动会话在进程/设备重启后的恢复、后台和电池行为尚未验证；启动时恢复保存的档案不会自动启动 VPN，已有前台服务通知渠道也不等于生产生命周期能力已就绪。
- 尚未实现生产级云端认证/存储/同步服务。
- 尚未宣称已实现 iOS、Windows、macOS 或 Linux 的可执行应用壳。

## 跨平台应用里程碑

1. 建立适用于所有目标平台的共享 UI/状态契约。
2. 建立账户/同步/备份契约与安全边界。**Core 契约层已完成。**
3. 将可复用 UI 提取到多平台 UI 层，并确保不泄漏平台 API。
4. 在平台无关服务契约之后实现账户认证与云端数据服务。
5. 将 Android 本地配置、HTTPS 订阅和手动文本导入接入内核无关流程。**本地文件和 HTTPS 入口已在 `11e6a8e` 通过 Android CI；手动文本导入已实现并等待本 PR CI。**
6. 实现 Android 生命周期控件和经过校验的 Core-to-VPN handoff。**代码与回归覆盖见 PR #114；自动 CI 验证 Android 测试、Debug APK 启动及固定版本的原生内核构建。真机 TUN/流量验证仍未完成。**
7. 增加 Android 本机加密档案持久化和 Core 重校验。**已在 PR #114 实现并通过 CI；云同步和设备备份不在本 MVP 范围内。**
8. 建立 Windows/macOS/Linux 共用的 Desktop JVM 应用壳。
9. 建立 iOS 应用入口和 Network Extension 边界。
10. 添加平台专属安全存储、后台生命周期、通知、网络状态和资源策略适配器。
11. 仅在适配器层验证后，按平台集成 Mihomo/sing-box/Xray。
12. 为所有目标平台增加设备/OS 回归验证和发布打包。

## 证据规则

只有同时具备源码证据和可复现的构建/测试证据，里程碑才标记为已实现。平台占位实现必须明确标示，直到真实执行并验证。
