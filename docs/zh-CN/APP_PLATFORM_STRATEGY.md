# AngelaNexus 全平台 APP 策略

## 目标

AngelaNexus APP 从架构第一天即面向 Android、iOS、Windows、macOS 和 Linux。

Android 是当前首先落地的平台验证，不是 APP 主平台，也不是架构中心。

## UI 架构

采用“共享 UI 语义 + 平台原生能力适配”。

共享 UI 负责：

- 首页
- 配置
- 代理
- 规则
- 安全
- GFW 状态
- 内核运行状态
- 日志与诊断
- 设置
- 账户与同步
- 备份与恢复
- 导入与配置编辑
- 统一状态模型

平台层负责：

- VPN / TUN
- 系统代理
- 后台生命周期
- 通知
- 权限
- 安全存储
- 网络状态
- 系统托盘/菜单栏
- 文件选择器
- 系统级应用排除
- OS-specific routing/firewall

共享 UI 不直接调用平台 API。

## 账户、同步与平台差异

五个平台共享同一账户公共数据模型，但不共享设备运行状态。

### 跨平台公共数据

- Profiles
- 订阅/导入来源元数据
- 节点与代理偏好
- 策略组偏好
- 路由策略
- 安全/防泄露偏好
- GFW 用户策略偏好
- 规则覆写
- UI 与应用通用偏好

### 平台独立数据

- VPN/TUN 授权和运行状态
- 系统代理状态
- 后台服务
- 网络接口
- 窗口/导航布局
- 快捷键
- OS-specific firewall/routing
- 当前运行时状态

### 设备专属数据

普通云同步默认永不包含：

- Token
- 私钥
- VPN/系统凭据
- Keystore/Keychain/Credential Store 内容
- 设备密钥
- 本地日志和缓存

详细规范见 [账户、同步与备份](APP_ACCOUNT_SYNC.md)。

## 备份与恢复

APP 必须支持立即备份、自动备份设置、云备份历史、本地备份文件、云恢复、本地恢复、恢复预览、选择性恢复，以及恢复后的 Core/安全策略重新校验。

恢复时，平台无关数据进入 Shared Core；平台差异由 Platform Bridge 处理。不支持的字段必须明确显示。

## UI 技术路线

共享 UI 优先采用 Compose Multiplatform 路线。具体依赖版本必须通过 CI 验证后才能成为仓库基线。

## 响应式 UI

### 手机

底部导航：

1. 首页
2. 配置
3. 代理
4. 规则
5. 设置

### 平板

采用自适应导航栏或双栏布局。

### Windows / macOS / Linux

采用侧边栏、中央工作区和可选详情区域，并支持键盘快捷键、上下文菜单、可调整窗口以及系统托盘/菜单栏。

桌面 UI 不是简单放大的手机 UI。

## 平台能力矩阵

| 能力 | Android | iOS | Windows | macOS | Linux |
|---|---|---|---|---|---|
| Shared UI | 目标 | 目标 | 目标 | 目标 | 目标 |
| 账户身份 | 目标 | 目标 | 目标 | 目标 | 目标 |
| 云公共数据 | 目标 | 目标 | 目标 | 目标 | 目标 |
| 本地备份恢复 | 目标 | 目标 | 目标 | 目标 | 目标 |
| 配置导入 | 实施中 | 规划 | 规划 | 规划 | 规划 |
| VPN/TUN | VpnService | Network Extension | TUN/WFP | Network Extension/TUN | TUN/routing |
| 系统代理 | 平台能力 | 平台能力 | 平台能力 | 平台能力 | 平台能力 |
| 后台运行 | Foreground Service | 系统约束 | Service | LaunchAgent/Daemon 等 | systemd/用户服务 |
| 安全存储 | Android Keystore | Keychain | Credential Manager/DPAPI | Keychain | Secret Service/受支持机制 |
| 托盘/菜单栏 | 可选 | 不适用 | 支持 | 支持 | 支持 |

“目标/规划”不等于“已实现”。只有代码、构建或设备验证证据成立后才能提升状态。

## 发布顺序

1. 共享 UI/状态模型基线
2. 账户/同步/备份数据模型与安全边界
3. Android 功能闭环
4. Desktop JVM 基线
5. iOS 入口与 Network Extension 边界
6. 云账户/同步服务
7. 各平台运行时适配
8. 各平台安全、后台、资源与系统集成
9. 真机/真实 OS 回归
10. 发布构建与签名体系

英文版 [Platform Strategy](../APP_PLATFORM_STRATEGY.md) 是规范性主文档。
