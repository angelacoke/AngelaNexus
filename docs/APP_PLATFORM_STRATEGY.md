# AngelaNexus 全平台 APP 战略

## 目标

AngelaNexus APP 从架构第一天即面向：

- Android
- iOS
- Windows
- macOS
- Linux

Android 只是当前最先落地的平台验证，不是 APP 的主平台，也不是唯一平台。

## UI 架构

采用“共享 UI 语义 + 平台原生能力适配”的模型。

```text
                 AngelaNexus Shared UI
                         |
        +----------------+----------------+
        |                |                |
     Mobile           Desktop          Native shell
 Android / iOS    Win / macOS / Linux   OS capabilities
        |                |                |
        +----------------+----------------+
                         |
                Account / Sync Layer
                         |
                  AngelaNexus Core
                         |
              Mihomo / sing-box / Xray
```

共享 UI 负责：

- 首页
- 配置
- 代理
- 规则
- 安全
- GFW 状态
- 内核状态
- 日志/诊断
- 设置
- 账户与云同步
- 备份与恢复
- 导入与配置编辑流程
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

共享 UI 不直接调用 Android、iOS、Windows、macOS 或 Linux API。

## 账户、云同步与平台差异

同一个 AngelaNexus 账户在五个平台共享一套用户公共数据模型，但不共享设备运行状态。

### 跨平台共享的账户公共数据

- Profiles
- 订阅/导入来源元数据
- 节点与代理偏好
- 策略组偏好
- 路由策略
- 安全/防泄露偏好
- GFW 用户策略偏好
- 规则覆写
- UI/应用通用偏好

### 平台独立的数据

- VPN/TUN 授权与运行状态
- 系统代理状态
- 后台服务
- 网络接口
- 平台窗口/导航布局
- 系统快捷键
- OS-specific firewall/routing
- 当前内核运行时状态

### 设备专属数据

默认永不进入普通云同步：

- Token
- 私钥
- VPN/系统凭据
- Keystore/Keychain/Credential Store 内容
- 设备密钥
- 本地日志和缓存

详细规范见 `docs/APP_ACCOUNT_SYNC.md`。

## 备份恢复

APP 必须提供：

- 立即备份
- 自动备份设置
- 云备份历史
- 本地备份文件
- 云恢复
- 本地恢复
- 恢复预览
- 选择性恢复
- 恢复后 Core/安全策略重新校验

恢复时平台无关数据进入 Shared Core；平台差异由 Platform Bridge 处理。不支持的字段必须明确显示，不能伪造恢复成功。

## UI 技术方向

优先采用 Compose Multiplatform 作为共享 UI 技术路线。官方文档明确支持 Android、iOS、Windows、macOS、Linux desktop，并支持共享 UI；平台仍保留独立入口和平台特有 API 层。

当前稳定线使用 Compose Multiplatform 1.12.x；具体依赖版本必须通过 CI 验证后才能提升为仓库基线。1.12.1 为当前已发布稳定版本。

## 现代化 UI 原则

参考 FlClash 的模块化、响应式和 Material 设计思路，但不复制其界面实现。

### 手机

底部导航：

1. 首页
2. 配置
3. 代理
4. 规则
5. 设置

### 平板

采用双栏/自适应导航：

- 左侧模块导航
- 右侧内容区

### Windows / macOS / Linux

采用桌面布局：

- 左侧导航栏
- 中央工作区
- 可选右侧状态/详情面板
- 键盘快捷键
- 鼠标右键菜单
- 系统托盘/菜单栏
- 可调整窗口尺寸

桌面 UI 不简单放大手机 UI。

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

“目标/规划”不是“已实现”。只有存在代码、构建或设备验证证据后才能提升状态。

## 发布顺序

1. 共享 UI/状态模型基线
2. 账户/同步/备份数据模型与安全边界
3. Android 功能闭环
4. Desktop JVM 基线：Windows/macOS/Linux 共用 UI
5. iOS 原生入口与 Network Extension 边界
6. 云账户/同步服务实现
7. 各平台内核运行时适配
8. 各平台安全、后台、资源与系统集成
9. 真机/真实 OS 回归
10. 发布构建与签名体系

## 强制原则

不能因为 Android 先完成，就把 Android API 渗透进 Core 或共享 UI。

不能因为某平台实现困难，就删除共同能力；必须明确标记：

- 已实现
- 已验证
- 部分支持
- 平台限制
- 待实现

所有平台最终使用同一套用户概念、同一套核心策略模型和同一套安全边界；平台差异由 Platform Bridge 实现。
