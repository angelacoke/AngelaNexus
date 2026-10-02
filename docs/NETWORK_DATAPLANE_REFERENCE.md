# AngelaNexus 网络数据面技术参考共识

版本：AN-TECH-REFERENCE v1.0
日期：2026-10-02

## 目的
将近期对 socket-layer 透明接入、eBPF 网络优化、直接路径与中继回退的研究正式纳入 AngelaNexus 架构参考。第三方项目只作为技术依据，不作为代码、品牌或架构继承来源。

## 1. Socket-layer 透明接入
参考 tunless。其公开资料展示了 Linux eBPF socket hooks、macOS Network Extension、Windows WFP 等不同接入机制，并强调在 socket 层保留目标和进程上下文。

AngelaNexus 因此采用：透明接入不是 TUN 的同义词。TUN、socket capture、WFP、Network Extension、eBPF、Root networking 等均属于 Ingress Capability，由 Capability Registry 按平台和运行环境协商。

必须区分 Supported、Partial、Unsupported、Unknown、Degraded、Failed。未知能力不得当作已支持。

## 2. eBPF 与网络状态优化
参考 Skyline Speeder 的方向：网络优化先观测，再分类，再经过能力和安全门禁，最后应用并观察结果。

统一生命周期：Measure -> Classify -> Verify -> Apply -> Observe -> Rollback。

RTT、排队延迟、重传、ECN、delivery rate 等必须共同参与判断。存在丢包不能直接证明属于随机丢包。

eBPF、拥塞控制、TC、sockops、发送冗余等高级能力不得成为基础代理的硬依赖。每个优化必须有独立能力检测、用户开关、运行时验证、指标、回滚和 benchmark。

## 3. 直接路径与中继回退
参考 Tailscale 的数据面、WireGuard 和 DERP 思路，AngelaNexus 建立统一 Path Registry。

路径生命周期：Discover -> Validate -> Prefer Direct -> Relay Fallback -> Re-probe -> Promote Direct。

路径候选至少记录 Path ID、Path Type、Ingress、Driver、Transport、Security、Health、Evidence、User Policy、Lifecycle State。

自动切换必须受用户策略约束。已有 Session 与 New Connection 必须分开处理，不能假定已有连接都能无损迁移。

## 4. 统一网络数据面
Flow / Intent -> Flow Identity -> Policy / Security -> Capability Negotiation -> Ingress Selection -> Path Selection -> Protocol / Transport -> Execution Driver -> Health / Evidence -> Recovery / Re-probe。

由此实现五项解耦：Ingress 与 Execution 解耦；透明接入与 TUN 解耦；路径与内核解耦；高级优化与基础代理解耦；故障转移与用户策略解耦。

## 5. DNS 与防泄露
DNS 是独立安全边界。平台必须记录 Query、Resolver、Answer、IPv4/IPv6、DNS transport、Capture source、Trust source、Cache state 和 Policy result。

必须同时考虑系统 DNS、应用 DNS、DoH、DoT、DoQ 和 IPv6。无法验证的 DNS 状态不得报告为完整安全。

## 6. 规则源防投毒
规则源必须记录 Source Identity、Trust Anchor、Version、Published/Fetch time、Content hash、Signature state、Parse state、Semantic validation、Changed ratio、Previous trusted version、Quarantine 和 Rollback 状态。

处理链：Fetch -> Verify -> Parse -> Validate -> Anomaly Check -> Quarantine/Accept。

规则数据即使来源可信，也只能产生平台规则数据，不得直接执行代码、修改二进制、修改信任锚或绕过安全基线。

## 7. Android Root
Root 不等于直接接管所有流量。采用 Standard VPN、Root Enhanced、Root Advanced、Experimental Native Networking 等能力层级，由 Capability Registry 验证 Android 版本、Root、UID/iptables/nftables/eBPF、IPv4/IPv6、DNS、TUN 和回滚能力。

Root 生命周期：Preflight -> Apply -> Verify -> Health -> Rollback。

## 8. 可观测性
平台必须能够解释当前 Flow、App、目标、Ingress、Policy、Driver、Path，以及为何选中它们；失败必须记录阶段、原因、候选路径和回退结果。

能力真实性继续遵循：Declared -> Supported -> Verified -> Operational -> Healthy。不得跨级推断。

## 9. 低功耗
持续控制 CPU、RAM、wakeups、battery、network probes、DNS queries、logging、telemetry 和 duplicate connections。

健康状态采用分级探测：Healthy 低频、Degraded 增强、Failed 恢复探测、Recovered backoff。不得为了智能化长期高频探测全部节点。

## 10. 对现有架构的补充
新增或扩展：Ingress Capability Registry、Path Registry、Network Evidence Store、Optimization Registry、Recovery Controller。

它们均属于平台层，不得绑定 Mihomo、sing-box 或 Xray 中的任何一个。三者继续作为平行 Compatibility Execution Backends。

## 11. 阶段性审计
每个同质实现完成后必须检查 Platform First、Kernel Lock-in、Canonical Model、用户控制、安全泄露、Capability 真实性、健康检查、故障回退、性能回归、可维护性和第三方品牌污染。

验证失败必须修复并重新验证；未验证成功不得进入下一阶段。

## 12. 实施优先级
P0：Capability Registry、Path Registry、Network Evidence、Ingress 抽象、规则源 Anti-Poisoning、Recovery Controller、自动行为解释。

P1：Android Root Adapter、Linux socket/eBPF prototype、Windows WFP boundary、macOS Network Extension boundary、DNS observation、IPv4/IPv6 leak verification、path health。

P2：eBPF 性能优化、拥塞感知优化、direct/relay 实验、自适应低功耗探测、高级链式路径调度。P2 不得成为基础代理硬依赖。

## 13. 参考与致谢
tunless：https://github.com/bojieli/tunless/
Skyline Speeder：https://github.com/CYBERVERSE-Research/skyline-speeder
Tailscale：https://tailscale.com/

第三方资料仅用于技术参考。正式项目代码、文档和 UI 保持 AngelaNexus 自身产品身份；第三方相关内容集中在正式致谢、许可证或技术参考位置。