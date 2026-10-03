# AngelaNexus Linux Kernel 技术参考

版本：AN-UPSTREAM-LINUX v1.0
日期：2026-10-03

## 1. 定位

Linux kernel 对 AngelaNexus 有直接参考价值，但**不是第四个代理内核**。

AngelaNexus 的 Mihomo、sing-box、Xray 仍属于平行的 Compatibility Execution Backends；Linux kernel 属于 Linux 平台的数据面与系统能力基础。平台层负责把 Intent / Policy 转换为经能力验证的系统网络操作，执行 Driver 再负责具体协议与传输。

因此本参考的核心边界是：

`Intent -> Policy -> Capability Registry -> Platform Ingress/Path -> Driver Scheduler -> Execution Driver`

而不是：

`Intent -> Linux kernel -> proxy kernel`

## 2. 对平台层最有价值的能力

### 2.1 TUN/TAP

Linux 内核文档明确说明 TUN/TAP 为用户空间程序提供数据包/以太网帧收发接口。TUN 工作在 IP packet 层，TAP 工作在 Ethernet frame 层。

AngelaNexus 应把 TUN/TAP 建模为 `Ingress Capability`，而不是把 TUN 等同于代理内核。

必须记录：

- device type
- owner / permission boundary
- IPv4 / IPv6 state
- route state
- lifecycle state
- attached execution path
- verification result

TUN 成功创建不能自动推出“全流量已接管”或“无泄漏”。

## 3. nftables / Netfilter

Linux 当前内核提供 nftables 的 Netlink 配置接口，并支持 flowtable、counter、conntrack、trace 等能力。

AngelaNexus 可将其作为 Linux 平台透明接入、策略执行、状态观察和故障诊断的候选能力。

原则：

1. 规则由平台 Policy Compiler 生成。
2. Driver 不得直接修改平台安全基线。
3. 应用规则前必须经过 syntax、semantic、conflict 和 rollback 检查。
4. 应支持 transaction/batch 式更新，避免半套规则生效。
5. 失败时必须恢复到最后一个已验证状态。
6. nftables 存在不代表当前运行环境一定允许或支持全部能力。

## 4. eBPF / socket / TC / XDP

Linux kernel 的 BPF 子系统提供多类网络程序入口，包括 cgroup socket、netfilter、TC、socket lookup、sockops、sk_msg、sk_skb 等；XDP/AF_XDP 还提供更靠近网卡的数据面能力。

这些能力与 AngelaNexus 的“Ingress 与 Execution 解耦”高度契合。

建议能力分层：

- `socket-observe`
- `socket-policy`
- `socket-redirect`
- `cgroup-network-policy`
- `tc-ingress`
- `tc-egress`
- `xdp-observe`
- `af-xdp-dataplane`

每一项都必须独立协商，不能因为内核支持 eBPF 就宣布整套 eBPF 网络能力可用。

## 5. AF_XDP 的使用边界

AF_XDP 面向高性能 packet processing，可把 XDP 数据重定向到用户空间 socket。Linux 官方文档同时区分 XDP_SKB 与 XDP_DRV，并描述 copy / zero-copy 等不同模式。

AngelaNexus 可以把 AF_XDP 作为未来高性能 Linux 数据面实验能力，但不应成为基础代理路径的硬依赖。

P2 阶段才考虑：

- high-throughput ingress
- packet batching
- zero-copy capability detection
- CPU affinity / NUMA awareness
- benchmark-driven fallback

基础路径必须在没有 AF_XDP 时仍可工作。

## 6. Socket-level 与 TUN 的关系

Linux BPF 可以在 socket 层进行过滤、选择、重定向和策略处理；TUN/TAP 则提供虚拟网络设备。因此二者属于不同层次的 Ingress Mechanism。

AngelaNexus 必须继续坚持：

- TUN != socket capture
- eBPF != proxy protocol
- nftables != execution Driver
- Linux kernel != Mihomo / sing-box / Xray

这样可以避免平台层重新产生 kernel lock-in。

## 7. WireGuard

Linux kernel 当前包含 WireGuard 网络驱动能力。它可以作为平台或传输能力参考，但在 AngelaNexus 中不应自动被建模为代理内核。

应区分：

- WireGuard transport capability
- WireGuard interface capability
- proxy protocol capability
- policy routing capability

具体是否使用由 Capability Registry、用户策略和 Driver Scheduler 决定。

## 8. 观测、验证和回滚

Linux kernel 的 trace、BPF、nftables trace 等能力可以增强 Network Evidence Store。

推荐证据链：

`Declared -> Supported -> Verified -> Operational -> Healthy`

例如：

- 声明支持 nftables：Declared
- 系统存在必要 API / kernel capability：Supported
- 成功安装测试规则并读取预期结果：Verified
- 实际流量通过并符合 Policy：Operational
- 持续运行、无泄漏且资源指标正常：Healthy

任何阶段失败都不得向上伪装成 Healthy。

## 9. 安全边界

Linux 平台实现必须特别关注：

- CAP_NET_ADMIN / privilege boundary
- /dev/net/tun 权限
- nftables rule ownership
- eBPF privilege / verifier constraints
- IPv4 / IPv6 consistency
- policy routing consistency
- DNS path consistency
- rollback atomicity
- kernel capability/version differences

平台适配器必须 fail-closed；能力未知时使用 `Unknown`，而不是推断为 `Supported`。

## 10. 对 AngelaNexus 三内核设计的具体影响

Linux kernel 参考不会改变三内核架构，反而进一步证明平台层与执行层必须分离：

| 层 | 责任 |
|---|---|
| Platform Intent | 描述用户希望发生什么 |
| Policy | 决定允许什么 |
| Capability Registry | 判断 Linux / Android / Windows / macOS 当前具备什么 |
| Ingress Adapter | TUN、socket、eBPF、nftables、WFP、Network Extension 等 |
| Path Registry | 管理 direct / relay / fallback 路径 |
| Driver Scheduler | 选择可执行的后端 |
| Mihomo / sing-box / Xray | 执行协议 / transport |
| Evidence Store | 记录验证与运行结果 |

## 11. 实施优先级

### P0

- Linux capability probing contract
- TUN state verification
- nftables transaction / rollback boundary
- IPv4/IPv6 route verification
- privilege boundary reporting

### P1

- Linux socket/eBPF prototype
- policy-routing verification
- DNS path observation
- nftables trace integration
- BPF capability matrix

### P2

- TC/eBPF optimization
- XDP / AF_XDP prototype
- zero-copy benchmarking
- advanced socket redirection
- kernel-assisted performance optimization

P2 能力不得成为基础代理功能的硬依赖。

## 12. 结论

Linux kernel 对 AngelaNexus **有高参考价值**，但用途是强化 Linux Platform Adapter / Ingress / Path / Evidence 层，而不是增加一个“Linux 内核代理”。

最重要的架构收益是进一步固化以下边界：

**Linux kernel 提供系统网络能力；AngelaNexus Platform Control Plane 决定策略；Driver Scheduler 选择执行后端；Mihomo / sing-box / Xray 执行具体协议与传输。**

## 13. 官方依据

- Linux kernel source tree: https://github.com/torvalds/linux
- Linux networking documentation: https://docs.kernel.org/networking/
- TUN/TAP: https://docs.kernel.org/networking/tuntap.html
- BPF: https://docs.kernel.org/bpf/
- AF_XDP: https://docs.kernel.org/networking/af_xdp.html
- nftables Netlink specification: https://docs.kernel.org/netlink/specs/nftables.html
