# AngelaNexus 网络验收与真实网络证据体系

版本：AN-NETWORK-ACCEPTANCE v1.0
日期：2026-10-02

## 1. 定位

Network Acceptance Harness 是 AngelaNexus 平台层的网络能力验收与证据系统。

它不是代理内核，不负责节点选择，不替代 Connection Path Manager，不直接承担长期网络遥测。它的职责是验证平台所声明的网络能力是否在具体平台、具体运行模式和具体网络环境中真实成立。

核心原则：

Scenario → Capability Gate → Prepare → Apply → Live Verify → Traffic Acceptance → Evidence → Active

失败路径：

Failure → Classify → Rollback → Cleanup Verify → Evidence → Recovery / Re-probe

无法验证的状态必须保持 Unknown、Unsupported、Conflict 或 Failed，不得提升为 Operational 或 Healthy。

## 2. 为什么纳入平台核心

AngelaNexus 的目标不是“能生成配置”，而是形成真实可用的跨平台网络系统。

仅完成以下任一项，都不足以证明网络能力成立：

- API 存在
- 配置生成成功
- 内核启动成功
- 路由命令执行成功
- TUN/socket/WFP/Network Extension 初始化成功
- 单元测试通过

必须进一步验证真实运行状态、真实流量路径、实际出口、DNS 行为、IPv4/IPv6 行为、应用身份以及失败后的清理结果。

因此 Network Acceptance Harness 成为 Platform First 架构中连接“能力声明”和“真实网络行为”的验证层。

## 3. 与现有架构的关系

统一数据面：

Flow / Intent
→ Flow Identity
→ Policy / Security
→ Capability Negotiation
→ Ingress Selection
→ Path Selection
→ Protocol / Transport
→ Execution Driver
→ Health / Evidence
→ Recovery / Re-probe

验收系统位于其中的验证边界，不改变上述权责。

### Capability Registry

确认目标场景需要的能力是否存在，并区分：

Declared
Supported
Verified
Operational
Healthy

### Path Registry

提供候选路径、Path ID、Path Type、用户允许状态、安全状态、验证状态和生命周期状态。

### Path Probe Executor

调用已经注入的平台探测入口。

不得自行选择节点，不得绕过 Path Registry，不得静默收集长期遥测。

### Connection Path Manager

形成 Decision ID，消费验收/探测结果，并把实际 Outcome 写回 Evidence Store。

### Network Evidence Store

保存有限、有界、短 TTL、可查询的网络证据。

### Recovery Controller / Re-probe Scheduler

在失败后按照用户策略和安全门禁决定是否恢复或重新探测。

### Kernel Adapter

只执行平台已经确定的执行计划。

## 4. Canonical Network Scenario

每个验收场景至少包含：

- Scenario ID
- Scenario Version
- Platform
- OS Version
- Runtime Mode
- Required Capabilities
- Flow Identity Source
- Ingress
- Policy
- DNS Transport
- Resolver
- Address Family
- Protocol
- Expected Path
- Expected Egress
- Security Expectations
- Timeout
- Retry Policy
- Low-power Constraints
- Rollback Requirement
- Evidence Schema

场景定义保持平台无关。

平台适配层负责把场景映射到真实 OS 网络接口，例如：

- Android VpnService
- Android Root networking
- Linux socket / eBPF / TUN
- Windows WFP
- macOS Network Extension
- iOS Network Extension

平台适配层不得改变场景的安全语义。

## 5. 最小真实网络验收矩阵

### 5.1 DNS

验证：

- Direct DNS
- Proxy DNS
- DNS capture
- DNS leak
- IPv4 answer
- IPv6 answer
- DoH
- DoT
- DoQ
- 应用自建 DNS
- 系统 DNS
- Resolver identity
- DNS cache behavior

只有实际存在对应能力时才执行相应场景。

### 5.2 TCP

验证：

- Direct TCP
- Proxy TCP
- Selected Path
- Actual Egress
- Connection setup
- Path failure
- New connection recovery

必须记录实际选择结果，不能只验证本地 socket 建立成功。

### 5.3 UDP

验证：

- Direct UDP
- Proxy UDP
- Selected Path
- Actual Egress
- Timeout behavior
- Failure recovery

UDP 不得因为 TCP 成功而被推断为已支持。

### 5.4 Identity

验证：

- App identity
- UID
- Process identity
- Package / Bundle identity
- Identity evidence source

不存在可靠证据时保持 Unknown。

### 5.5 Routing

验证：

- Policy routing
- Split routing
- Bypass
- Local output capture
- Self-loop protection
- IPv4 route
- IPv6 route
- Routing table ownership

### 5.6 Address Family

IPv4 与 IPv6 必须分别验证。

IPv4 正常不代表 IPv6 正常。

IPv6 不可验证时不得报告“无泄露”。

### 5.7 Ingress

按照平台真实能力分别验证：

- TUN
- Socket capture
- eBPF
- WFP
- Network Extension
- Root networking

透明代理不是 TUN 的同义词。

### 5.8 Recovery

验证：

- Failure detection
- Candidate rejection
- Rollback
- Cleanup verification
- Re-probe scheduling
- Successful recovery
- Quarantine / reinstatement

Existing Session 与 New Connection 必须分开验证。

## 6. 安全门禁

所有高风险网络验收必须先通过：

1. 用户允许
2. 平台能力
3. 安全状态
4. 路径验证
5. 配置完整性
6. 运行时准备状态

任何一项失败：

- 不得继续 Apply
- 不得报告成功
- 必要时执行 Rollback
- 必须验证 Cleanup
- 必须记录 Failure / Rejected 原因

## 7. 生命周期

### Prepare

创建或取得明确的资源事务。

必须知道：

- 将修改什么
- 所有者是谁
- 如何回滚
- 如何验证清理

### Apply

只执行已经通过安全门禁的变更。

### Live Verify

检查真实运行状态，而不是仅检查函数返回值。

### Traffic Acceptance

发起最小必要的真实流量测试，验证：

- 目标
- 协议
- 路径
- 出口
- DNS
- 身份
- 安全策略

### Evidence

将结果写入 Network Evidence Store。

### Active

只有在场景所要求的关键验证全部成功时，才允许提升为对应证据状态。

### Failure

失败必须分类：

- capability-unavailable
- user-denied
- security-failed
- verification-failed
- routing-conflict
- dns-conflict
- address-family-failed
- path-failed
- traffic-failed
- cleanup-failed
- timeout
- unknown

## 8. 回滚与清理

Network Acceptance Harness 不允许采用“命令执行成功即认为回滚成功”的逻辑。

正确流程：

Rollback Command
→ Live Cleanup Inspection
→ Cleanup Verified
→ Evidence Updated

如果 Cleanup Inspection 失败：

- 状态保持 Failed
- 不得伪装为 Rolled Back
- 必须阻止下一阶段可能造成的状态污染
- 由 Recovery Controller 决定后续恢复路径

## 9. 地址空间与 DNS Namespace

真实网络验收必须显式记录：

- Test CIDR
- Fake-IP namespace
- Real-IP namespace
- Upstream gateway
- DNS listener
- DNS port
- Routing table
- Policy mark
- IPv4/IPv6 namespace

以下冲突必须直接标记为 Conflict 或 Failed：

- Fake-IP 与真实网络地址空间重叠
- DNS listener 冲突
- 上游网关冲突
- 路由表冲突
- IPv6 前缀冲突
- Policy mark 冲突

不得通过修改预期结果掩盖环境冲突。

## 10. Evidence 规则

Evidence 至少包含：

- Scenario ID
- Platform
- Runtime Mode
- Path ID
- Decision ID
- Timestamp
- Result
- Security State
- Verification State
- 必要网络指标
- Evidence Source

指标遵循最小化原则。

允许的典型指标：

- RTT
- Base RTT
- Queueing Delay
- Loss Ratio
- Retransmission Ratio
- Delivery Rate
- DNS Latency
- Connection Setup Time
- Sample Count

不得保存完整流量内容，不得建立无限期用户行为日志。

## 11. 与自适应路径选择的闭环

真实验收结果进入：

Connection Path Manager
→ Decision ID
→ Execute
→ Observe
→ Record Outcome
→ Network Evidence Store
→ Re-evaluate

Outcome：

- Success
- Degraded
- Failure

单次失败不能直接绕过安全门禁。

Path Re-probe 必须继续受到：

- User Policy
- Capability
- Security
- Verification
- Health

共同约束。

## 12. Android Root 专项验收

Android Root 不等于天然透明。

Root 模式只有在必要运行时证据成立后才能进入可用状态，包括：

- Root Available
- Root Authorized
- TCP
- UDP
- DNS
- IPv4
- IPv6
- UID Identity
- Local Output Capture
- Policy Routing
- Atomic Rollback

ICMP 与 Process Identity 作为独立能力，不得为了通过 Root readiness 而虚假提升。

Root 验收：

Capability Preflight
→ Prepare
→ Apply
→ Live Verify
→ Traffic Acceptance
→ Health
→ Rollback

System VPN 不得宣称 Root 能力。

## 13. 五平台落地边界

### Android

当前优先建立：

- System VPN
- Root Transparent
- UID identity
- IPv4/IPv6
- DNS
- policy routing
- rollback verification

### Linux

后续验证：

- TUN
- socket layer
- eBPF
- UID/cgroup identity
- policy routing
- namespace
- IPv4/IPv6

### Windows

后续验证：

- WFP
- process identity
- system proxy
- DNS
- IPv4/IPv6
- rollback

### macOS

后续验证：

- Network Extension
- per-process identity
- DNS
- gateway scenarios
- IPv4/IPv6
- address-space compatibility

### iOS

后续验证：

- Network Extension
- app identity
- DNS
- IPv4/IPv6
- platform restrictions
- lifecycle recovery

能力必须逐平台实际验证，不能由其他平台推断。

## 14. 隔离 Virtual Network Lab

长期建立独立网络实验环境。

最小组成：

Client
→ Test Gateway
→ AngelaNexus Runtime
→ Execution Backend
→ Controlled Upstream
→ Observable Egress

实验环境应能验证：

- DHCP
- DNS
- NAT
- TCP
- UDP
- IPv4
- IPv6
- App / UID identity
- Policy routing
- Actual egress
- Failure recovery
- Rollback

实验环境属于测试基础设施，不进入终端产品运行时。

## 15. 测试等级

### Level 0 — Static

检查：

- schema
- configuration
- capability declaration
- rule consistency

### Level 1 — Unit

检查：

- lifecycle
- registry
- evidence
- policy
- failure classification

### Level 2 — Component

检查：

- native adapter
- driver
- DNS adapter
- routing adapter
- kernel adapter

### Level 3 — Runtime

真实运行环境验证：

- route
- socket
- DNS
- process / UID
- IPv4/IPv6

### Level 4 — Network Acceptance

真实流量验证：

- selected path
- actual egress
- leak
- recovery
- rollback

### Level 5 — Cross-platform Acceptance

在 Android、Linux、Windows、macOS、iOS 分别验证对应能力。

只有对应等级通过，能力才可提升到对应证据状态。

## 16. 与项目宪纲的一致性

本体系遵循：

- Platform First
- Kernel Parallel
- Canonical Model
- User Control
- Fail Closed
- No False Precision
- Security as Platform Capability
- Transparent Proxy ≠ TUN
- Existing Session ≠ New Connection
- Automatic Behavior Must Be Explainable
- Automatic Behavior Must Be Reversible
- Platform-specific capability must remain isolated
- Unverified capability must never be presented as operational

## 17. 实施顺序

第一阶段：

- Scenario schema
- Capability Gate
- Live Verify
- Evidence integration
- Rollback verification

第二阶段：

- Android System VPN acceptance
- Android Root acceptance
- DNS leak acceptance
- IPv4/IPv6 acceptance
- UID identity acceptance
- Policy routing acceptance

第三阶段：

- Linux
- Windows
- macOS
- iOS

第四阶段：

- Isolated Virtual Network Lab
- automated real traffic acceptance
- cross-platform regression
- performance benchmark
- low-power benchmark

任何未经过真实网络验收的能力，不得在产品状态中标记为 Healthy。

## 18. 技术来源处理原则

外部项目和资料只用于技术研究与架构验证。

AngelaNexus 不继承外部项目的品牌、产品定位或代码组织。

涉及外部资料的正式声明集中放在项目致谢、许可证和技术参考区域。

本文件的目标是把外部研究中可验证的工程方法转化为 AngelaNexus 自身的平台能力和测试规范。
