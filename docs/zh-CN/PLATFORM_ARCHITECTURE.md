# AngelaNexus 平台架构

AngelaNexus 从第一层架构开始就是实际的跨平台网络代理应用。

## 目标平台

- Android
- iOS
- Windows
- macOS
- Linux

没有任何单一平台是架构中心。平台特有能力通过契约暴露，并由各平台独立实现。

## 运行时分层

```text
AngelaNexus UI
   |
Application / Orchestration
   |
Platform-neutral Core
   |-- Canonical Node / Flow / Pipeline Model
   |-- Configuration / Import
   |-- Routing Policy
   |-- Strategy Groups
   |-- Chain
   |-- DNS / Security Policy
   |-- Health / Self-healing
   |-- Resource Policy / Telemetry
   |
Protocol Adapter Layer
   |-- Protocol Identification / Capability Contract
   |-- Capability Negotiation
   |-- Protocol-neutral Runtime Descriptors
   |
Transport Abstraction
   |-- Stream / Datagram Contracts
   |-- Transport Capability Negotiation
   |
Execution Backend Layer
   |-- Compatibility Backend Adapters
   |-- Mihomo
   |-- sing-box
   |-- Xray
   |
Platform Contract
   |-- TUN / VPN
   |-- System Proxy
   |-- Process / Application Exclusion
   |-- Network State
   |-- Lifecycle
   |-- Notifications
   |-- Secure Storage
   |
Native Platform Implementation
   |-- Android
   |-- iOS
   |-- Windows
   |-- macOS
   `-- Linux
```

## 统一能力中心

用户面对的是统一的 AngelaNexus 操作概念，而不是分别学习 Mihomo、sing-box 和 Xray。

例如：

```text
Google -> US
国内 -> 直连
AI -> AI 策略
Telegram -> 故障转移
默认 -> 自动选择
```

这些策略首先进入内核无关的路由模型，再由适配器转换为执行后端所需的配置和 API 调用。适配器不得重新定义用户策略语义。

## 能力差异必须显式表达

对于每项能力，必须区分：

- 已支持且可以直接编译；
- 已支持但使用不同的原生机制；
- 部分支持；
- 不可用；
- 未知或尚未验证。

不等价的能力不得静默删除或改变为其他策略。限制必须向用户明确展示。

## 资源效率边界

资源优化属于平台策略层，运行时负责提供实际测量。

平台可以协调：

- 自适应健康检查频率；
- 事件驱动状态观察；
- 有界的日志、缓存和遥测保留；
- 规则集刷新；
- 空闲/低功耗优化；
- 防止重复启动执行后端。

安全、fail-closed 和路由正确性优先于资源节省。

## 非可协商边界

Core 不得直接依赖 Android、iOS、Windows、macOS 或 Linux API。平台实现可以依赖原生 API，但反向依赖被禁止。

## 现实平台限制

平台能力并不完全相同：

- Android VPN 使用 VpnService 及经过验证的运行时嵌入边界；
- Apple 透明代理能力依赖 Network Extension 及具体系统限制；
- Windows 透明代理可能需要 WFP/TUN、安装和服务权限；
- Linux 可通过 TUN、路由、iproute2 或防火墙能力实现系统集成；
- 系统代理不等价于 TUN/VPN。

所有能力必须按实际 capability 协商。缺失能力应明确报告为 unsupported，而不是静默降级。

## 执行后端原则

Core 生成 backend-neutral runtime plan。协议和传输先独立解析，再选择执行后端。后端专属配置语法只能存在于兼容适配器内部。

Mihomo、sing-box 和 Xray 是兼容执行后端，而不是永久的生产架构中心。独立或原生执行能力必须经过单独验证后才能声明生产支持。

## 证据原则

功能只有在以下至少一项成立时才能标记为 implemented：

1. 官方上游 source/API/schema 证明集成；
2. 可重复的 build/test 提供证据；
3. 平台实现已经存在并实际运行验证。

架构占位内容必须明确标记，不能当作已经工作的功能。

英文版 [Platform Architecture](../PLATFORM_ARCHITECTURE.md) 是规范性主文档。
