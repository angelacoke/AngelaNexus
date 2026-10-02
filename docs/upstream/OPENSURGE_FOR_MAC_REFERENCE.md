# OpenSurge-for-Mac 技术参考与 AngelaNexus 吸收项

参考项目：YTwsy/OpenSurge-for-Mac
仓库：https://github.com/YTwsy/OpenSurge-for-Mac
核验日期：2026-10-02

## 1. 定位

OpenSurge-for-Mac 是值得纳入 AngelaNexus 正式架构参考库的网络网关与控制面实践案例。公开文档显示，它将 macOS 主机作为局域网网关，组合 DHCP/DNS 接管、按设备策略、代理引擎、宿主路由和恢复状态机，并强调虚拟实验与真实网络验收形成工程证据。

AngelaNexus 吸收的是可迁移的工程原则，而不是复制 macOS 专属实现。

## 2. 正式吸收项

### 2.1 设备级策略模型

统一抽象：
DeviceIdentity -> DevicePolicy -> RouteDecision -> KernelExecution

设备身份可以依据平台能力使用：
- MAC
- 稳定 IPv4
- IPv6 标识
- 应用/进程身份
- Android UID / package
- Windows/macOS/Linux 平台身份
- 网关侧 DHCP 租约或其他可信设备标识

核心原则：平台负责身份与策略，内核负责执行。

### 2.2 网关生命周期状态机

统一抽象：
Stopped -> Preparing -> Applying -> Running -> Degraded -> Recovering -> Restored -> Stopped

任何涉及系统网络接管的能力都必须具备：
- 启动前能力检查
- 用户明确授权
- Apply 前安全检查
- 运行态验证
- 异常检测
- 回滚
- 回滚后的恢复验证

不得仅以“进程仍存在”判断网关健康。

### 2.3 真实网络验收

明确区分 Virtual Lab 与 Real Network Acceptance。

虚拟测试不能替代：
- DHCP/DNS 实际服务
- IPv4/IPv6 实际路径
- NAT/转发
- TUN/TAP/VPN/系统代理路径
- 多设备并发
- DNS 泄漏
- 地址族泄漏
- 路由冲突
- 原生网络恢复

真实设备验收结果必须进入 Evidence Store，并关联 scenario、platform、runtime mode、path、decision 和 verification state。

### 2.4 恢复优先

网络平台的停止、崩溃、升级、重启、权限撤销都必须设计为可恢复事务。

重点吸收：
- 启动会话/运行实例识别
- stale runtime detection
- interrupted state
- 明确恢复提示
- cleanup 后再次验证宿主网络
- 恢复失败时禁止宣称“已恢复”

### 2.5 供应链与发布完整性

正式发布链增加：
- 发布物 SHA-256
- 构建来源证明
- provenance / attestation
- 上游版本与 commit 固定记录
- 第三方源码/许可证对应关系
- 下载物验证
- 发布前完整性检查

与 AngelaNexus 现有 License Policy、Security Integrity 和上游同步体系结合，不另建孤立体系。

## 3. 不直接复制的实现

以下属于 OpenSurge-for-Mac 的平台实现，不直接进入跨平台核心：
- macOS pf
- macOS 专属 forwarding
- dnsmasq 强制依赖
- macOS 菜单栏实现
- macOS 专属安装/权限流程
- 仅适用于 macOS 的 TUN/DHCP 拓扑

AngelaNexus 通过 Platform Adapter 映射到 Android、Windows、macOS、Linux、iOS 各自的原生网络能力。

## 4. 与当前 AngelaNexus 实现的对应关系

| OpenSurge 实践 | AngelaNexus |
|---|---|
| 网关控制面 | Platform Control Plane |
| 每设备策略 | Device Policy Engine |
| 网关状态机 | Network Lifecycle State Machine |
| 真实网络验收 | Network Acceptance Harness |
| 恢复状态机 | Rollback + Cleanup Verification |
| Virtual Lab | Platform/Kernel Test Harness |
| 发布校验 | Security Integrity + Release Policy |
| 构建来源证明 | Supply-chain Evidence |
| mihomo 执行 | Kernel Adapter，不上升为平台规则 |

当前 src/platform/network-acceptance-harness.js 已落实关键的验收、失败分类、回滚和清理验证基础设施；后续把设备策略和网关生命周期接入同一平台抽象。

## 5. 架构约束

1. 平台层决定“在哪里、对谁、何时、走什么策略”。
2. 内核层决定“如何执行代理协议和数据面”。
3. 任何网络接管必须可验证、可回滚、可恢复。
4. 测试通过不等于真实网络成功；真实网络证据必须单独记录。
5. 供应链证明属于发布可信度的一部分。
6. 设备级策略不得破坏用户已经明确设置的全局策略。
7. IPv4、IPv6、DNS、QUIC、TCP、UDP 等路径必须分别验收，不允许以单一路径结果代表全部网络行为。
8. 平台不隐藏关键决策；用户可见策略必须可解释、可审计。

## 6. 参考价值结论

纳入 AngelaNexus 正式参考体系。

正式吸收：
- 设备级策略
- 网关生命周期
- 真实网络验收
- 恢复机制
- 供应链验证

仅作平台适配参考：
- macOS 专属数据面实现

不复制：
- UI/品牌
- 项目结构
- 平台专属实现

本参考不改变 AngelaNexus 的核心目标，也不改变 Mihomo / sing-box / Xray 三内核并行架构；它强化的是平台层如何安全控制、验证和恢复网络数据面。
