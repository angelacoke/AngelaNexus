# AngelaNexus 底层宪级纲领

**项目：AngelaNexus**  
**定位：智能网络代理平台**  
**纲领版本：AN-Constitution v1.1**

> 本文件是 AngelaNexus 后续架构设计、代码实现、测试验证、CI、发布与维护的底层宪级约束。任何后续实现均不得违反本纲领；如发现现有实现与本纲领冲突，应优先修复架构冲突，再继续推进后续开发。

## 第一章：项目根本原则

### 第一条：项目定位

AngelaNexus 是一个**智能网络代理平台**。

其目标不是成为某一个代理执行内核的客户端外壳，而是建立独立、跨平台、可持续演进的网络代理平台基础设施。

平台负责：

- 配置理解
- 身份识别
- 策略处理
- 路由编排
- DNS
- 安全与防泄露
- GFW 相关适配
- 链式代理
- 故障转移
- 生命周期
- 系统集成
- 用户界面
- 数据与配置管理
- 诊断与恢复

底层协议执行能力通过统一抽象接入。

## 第二章：最高架构原则

### 第二条：Platform First

**平台优先，平台拥有最终架构控制权。**

所有跨协议、跨节点、跨执行后端、跨平台的逻辑必须属于 AngelaNexus 平台层。

不得把平台核心能力绑定到某一个具体内核。

### 第三条：Kernel Parallel

Mihomo、sing-box、Xray 等执行后端平行存在，不设主内核、从内核或架构中心。

保留成熟执行后端的目的，是兼容性、稳定性和协议覆盖，而不是让平台永久依赖某一后端的内部架构。

### 第四条：内核降级为执行后端

长期架构方向：

```
                    AngelaNexus
                         │
              ┌──────────┴──────────┐
              │                     │
        Platform Intelligence   Platform Runtime
              │                     │
        Identity / Policy       TUN / DNS / OS
        Routing / Security      Lifecycle / System
              │                     │
              └──────────┬──────────┘
                         │
               Protocol Adapter Layer
                         │
                Transport Abstraction
                         │
              ┌──────────┼──────────┐
              │          │          │
          Native      Native     Compatibility
          Adapter     Adapter       Backend
              │          │          │
           Protocol    Protocol   Existing backends
```

最终目标是：

> **平台能力独立于任何单一执行后端。**

这不是一次性删除现有后端，而是渐进迁移。

## 第三章：平台与执行后端边界

### 第五条：平台负责“决定”

平台负责：

- 流量身份识别
- 目标识别
- 规则匹配
- Match Set 计算
- 策略解析
- 路由编排
- 节点选择
- 链式代理编排
- 故障转移
- DNS 策略
- 安全策略
- 连接许可与拒绝
- 恢复策略

### 第六条：执行后端负责“执行”

执行后端只负责被平台授权的：

- 协议解析
- 节点连接
- 加密与握手
- 数据传输
- 协议级连接管理
- 平台要求的底层网络执行能力

执行后端不得拥有 AngelaNexus 的全局策略决定权。

## 第四章：统一抽象原则

### 第七条：Canonical Model

所有外部配置首先进入 AngelaNexus 自己的统一模型：

```
订阅 URL / 本地 YAML / JSON / 分享链接 / 单节点 / 多节点
        ↓
Format Detection
        ↓
Parse
        ↓
Normalize
        ↓
Validate
        ↓
Deduplicate
        ↓
Canonical Node Model
        ↓
Protocol Adapter
        ↓
Transport
        ↓
Execution
```

外部配置格式不得直接成为平台内部数据模型。

### 第八条：协议与传输解耦

协议适配与传输执行必须逐步分离：

```
Node
 ↓
Protocol
 ↓
Protocol Adapter
 ↓
Transport
 ↓
Execution
```

不得把“某协议 = 某内核”写死为平台架构规则。

## 第五章：智能系统原则

### 第九条：智能不得取代用户

AngelaNexus 可以：

- 分析
- 检测
- 识别
- 推荐
- 预测
- 提示
- 解释
- 发现冲突
- 给出候选方案

但涉及用户网络行为的重要决策，原则上必须由用户拥有最终控制权。

系统不得借“智能”之名偷偷改变用户配置。

### 第十条：所有自动行为必须可见

自动行为应能够说明：

- 为什么执行
- 影响什么
- 风险是什么
- 当前状态
- 自动做了什么
- 最终结果
- 是否失败
- 如何恢复
- 是否存在冲突
- 用户如何关闭
- 用户如何撤销

自动化必须可解释、可控、可撤销。

## 第六章：规则系统宪则

### 第十一条：规则采用并行语义

AngelaNexus 平台规则采用**并行匹配**，而不是第一条命中即停止。

一个流量可以同时命中：

- App Rule
- Domain Rule
- Process Rule
- Port Rule
- Protocol Rule
- DNS Rule
- IP Rule
- Security Rule
- GFW Rule

平台首先得到完整 **Match Set**，然后计算 **Execution Plan**。

### 第十二条：禁止把 order 当作策略语义

规则 `order` 只能用于展示、编辑和管理，不得成为第一匹配、第一优先、第一执行的核心语义。

规则重叠必须进行关系分析，而不是简单覆盖。

### 第十三条：冲突不得静默解决

如果多个有效规则产生无法安全合并的冲突：

```
Match Set
    ↓
Conflict Analysis
    ↓
Conflict
    ↓
Fail Closed / User Resolution
```

不得偷偷替用户选择一个规则。

## 第七章：流量身份原则

### 第十四条：精确识别，但禁止虚假精确

平台支持尽可能细粒度的 Flow Identity。

**应用：**

- Package ID
- Bundle ID
- App ID
- UID
- App Instance

**进程：**

- Process Name
- Executable
- PID

**网络：**

- Domain
- SNI
- IP
- Port
- Protocol
- Transport

**DNS：**

- Query
- Answers
- Resolver

同时必须保留 **Evidence Source**。

不能确定的信息必须保持未知或 `null`，不得猜测。

## 第八章：安全与隐私宪则

### 第十五条：安全属于平台基础能力

安全不是某一个执行后端的附加功能。

平台逐步统一管理：

- DNS 防泄露
- IPv4/IPv6 泄露控制
- TUN 边界
- 系统代理边界
- 应用绕过
- 路由绕过
- 节点异常
- 连接异常
- 配置安全
- 本地数据安全
- 日志安全
- 凭据安全

### 第十六条：Fail Closed 优先

涉及安全边界的未知、冲突或不可验证状态，不得静默放行。

平台必须区分：

- Confirmed
- Probable
- Unknown
- Unsupported
- Conflict
- Failed

不得把未知状态伪装成成功。

## 第九章：网络环境适配原则

### 第十七条：GFW 相关能力属于平台层

GFW 相关检测、策略和网络环境适配属于 AngelaNexus Platform Intelligence / Runtime。

执行后端只执行平台产生的结果。

### 第十八条：国内/国际流量必须可表达

平台必须能够表达：

- 国内 → 原生网络路径
- 国际 → 代理路径
- 特殊目标 → 指定策略
- 指定应用 → 指定策略

不得未经用户授权擅自改变用户已有安全、隐私和路由策略。

## 第十章：链式代理与故障转移

### 第十九条：链式代理属于平台编排能力

链式代理不是某一个执行后端的专属概念。

平台抽象任意合法 Pipeline，例如：

```
Node A
  ↓
Node B
  ↓
Node C
  ↓
Destination
```

角色由实际 Pipeline 决定，而不是写死。

### 第二十条：故障转移属于平台

平台负责：

- 健康检测
- 故障识别
- 候选节点
- 新连接迁移
- 重连
- 恢复
- 用户提示

必须明确区分 New Connection 与 Existing Session，不能假定已有连接都能无损迁移。

## 第十一章：跨平台宪则

### 第二十一条：五平台平等

目标平台：

- Android
- iOS
- Windows
- macOS
- Linux

Android 是当前首先落地的可执行表面，不是架构上的唯一中心。

平台核心必须保持 Platform Neutral。

### 第二十二条：平台特有能力必须隔离

例如：

- Android VpnService
- Windows System Proxy
- macOS Network Extension
- Linux TUN
- iOS Network Extension

均属于 Platform Abstraction Layer，不得直接污染核心业务逻辑。

## 第十二章：Root 与透明代理

### 第二十三条：追求理论上尽可能完整的透明代理

透明代理能力必须根据：

- Platform Capability
- OS Capability
- Root Capability
- Backend Capability
- Hardware / Network Limitation

分别验证。

不能为了宣传而把无法验证的能力称为“真正透明代理”。

Android Root 环境应提供明确的高级选项，并遵循安全、可解释和用户控制原则。

## 第十三章：资源效率原则

### 第二十四条：低资源优先

持续控制：

- CPU
- RAM
- Battery
- Network overhead
- Background activity
- DNS overhead
- Connection duplication
- Logging overhead

新增功能必须考虑功能收益与资源成本。

## 第十四章：上游与事实依据原则

### 第二十五条：事实必须可验证

涉及网络协议、系统 API、执行后端、平台能力和标准时，以**最新稳定、可信、可验证的官方或一手资料**为依据。

技术事实链：

```
Source
 ↓
Version / Commit
 ↓
Original Definition
 ↓
AngelaNexus Implementation
 ↓
Test / Verification
```

### 第二十六条：稳定版本优先

必须明确区分：

- Stable
- Preview
- Beta
- Alpha
- RC
- Development

不得把测试版本当作稳定基线。

## 第十五章：兼容后端原则

### 第二十七条：现有后端不得突然删除

现有 Mihomo、sing-box、Xray 继续作为 Compatibility Execution Backend。

迁移路径：

```
Existing Backend
      ↓
Backend Adapter
      ↓
Protocol Adapter
      ↓
Canonical Node
```

随着 AngelaNexus 自有能力成熟，再逐协议迁移。

## 第十六章：第三方与项目独立性

### 第二十八条：AngelaNexus 必须保持独立

正式项目代码、文档、UI 和功能命名必须保持 AngelaNexus 自身产品身份。

第三方项目、协议实现、开源组件、参考实现等需要声明时，集中在 LICENSE、NOTICE、ACKNOWLEDGEMENTS 等正式位置。

## 第十七章：开发与验证宪则

### 第二十九条：验证先于推进

所有开发阶段遵循：

```
当前状态
   ↓
验证
   ↓
通过？
 ┌─┴─┐
否   是
│     │
修复   ↓
│    下一阶段
↓
重新验证
```

未验证成功，不得进入下一阶段。

### 第三十条：失败必须修复，而不是绕过

出现编译、测试、CI、构建、签名、兼容性、运行时或架构检查失败时：

```
定位
 ↓
修复
 ↓
重新执行
 ↓
重新验证
```

单一问题原则上最多进行 5 次修复尝试；仍失败则停止推进并保留明确失败状态。

## 第十八章：架构审计原则

### 第三十一条：每个完整实现类别完成后必须审计

进入下一类别前必须检查：

- 是否违反 Platform First
- 是否产生 Backend Lock-in
- 是否违反 Parallel Match
- 是否引入隐式优先级
- 是否产生错误自动决策
- 是否破坏用户控制
- 是否产生安全泄露
- 是否破坏跨平台
- 是否破坏 Canonical Model
- 是否引入第三方品牌污染
- 是否违反稳定版本要求

通过后才能进入下一类。

## 第十九章：最高层架构关系

```
┌───────────────────────────────────────────────┐
│                  AngelaNexus                  │
│             智能网络代理平台                 │
├───────────────────────────────────────────────┤
│                 User Interface                │
├───────────────────────────────────────────────┤
│              Application API                 │
├───────────────────────────────────────────────┤
│           Platform Intelligence              │
│                                               │
│ Identity │ Match Set │ Policy │ Routing      │
│ Security │ GFW      │ DNS    │ Diagnostics   │
├───────────────────────────────────────────────┤
│              Platform Runtime                │
│                                               │
│ TUN │ OS Integration │ Lifecycle │ Recovery  │
├───────────────────────────────────────────────┤
│          Canonical Data / Model              │
│                                               │
│ Config │ Node │ Flow │ Pipeline │ Capability│
├───────────────────────────────────────────────┤
│            Protocol Adapter Layer             │
│                                               │
│ VLESS │ VMess │ Trojan │ SS │ Hysteria │ ...│
├───────────────────────────────────────────────┤
│             Transport Abstraction             │
│                                               │
│ TCP │ UDP │ TLS │ QUIC │ HTTP │ ...          │
├───────────────────────────────────────────────┤
│         Compatibility Execution Layer        │
│                                               │
│ Mihomo │ sing-box │ Xray │ Future Backends   │
├───────────────────────────────────────────────┤
│                 OS / Network                 │
└───────────────────────────────────────────────┘
```

核心原则：

> **AngelaNexus 决定，Adapter 翻译，Transport 执行，Compatibility Backend 兼容；任何单一内核都不得成为平台的大脑。**

## 第二十章：宪级优先级

发生需求冲突时，依次遵循：

1. 用户安全与数据保护
2. 用户控制权
3. 平台架构独立性
4. 正确性与可验证性
5. 跨平台一致性
6. 稳定性
7. 兼容性
8. 性能与资源效率
9. 智能化与自动化
10. UI 与易用性优化

低层级目标不得破坏高层级原则。

## 第二十一章：最终架构哲学

以后不再把核心问题定义为：

> “怎么把三个内核整合得更好？”

而定义为：

> **“怎么建立一个独立于执行后端的网络代理平台，而让各种协议执行能力自然接入这个平台？”**

长期演进路线：

```
Kernel-Centric
      ↓
Kernel-Abstraction
      ↓
Platform-Centric
      ↓
Protocol-Centric
      ↓
Transport-Abstraction
      ↓
Backend-Independent
```

本纲领自写入项目起，作为 AngelaNexus 后续开发、架构调整、代码实现、测试、CI、发布和维护的底层宪级约束。

## 第二十二章：统一意图与三内核能力协商调度原则

### 第三十二条：统一意图，不统一底层实现

AngelaNexus 应将用户可理解的网络行为抽象为统一 **Intent**，由平台负责解释、组合、验证和编排，再由执行后端负责实际执行。

统一的对象是：

- 用户网络意图
- 策略语义
- 路由要求
- 安全要求
- DNS 要求
- 连接要求
- 协议/传输要求
- 平台能力要求
- 用户偏好

不强行统一的对象是：

- 各执行后端内部实现
- 内核特有协议能力
- 内核特有传输能力
- 内核特有优化
- 内核特有兼容机制
- 无法可靠映射的原生能力

核心原则：

> **统一意图、统一标准、统一调度；保留内核差异、原生能力和底层实现。**

### 第三十三条：三内核平行待命

Mihomo、sing-box、Xray 在平台架构中平行存在。

平台可以使三个执行后端保持可用、可探测、可调度的待命状态，但：

> **待命不等于同时处理同一条流量。**

同一 Session 原则上只能由一个明确授权的执行 Driver 承担，除非该 Session 的 Execution Plan 明确要求合法的多阶段 Pipeline / Chain。

不得通过简单的“轮流使用内核”作为调度语义。

### 第三十四条：Capability Registry

每个执行 Driver 必须通过统一能力描述向平台报告自身能力。

能力至少包括：

- Protocol
- Transport
- TLS / Security Mode
- UDP
- IPv4 / IPv6
- Multiplex
- Chain
- DNS
- TUN / Platform Integration
- Operating System
- Architecture
- Root / Privilege Requirement
- Driver Version
- Health
- Limitations
- Unsupported Features
- Native Extensions

能力状态必须可验证，并允许：

- Supported
- Unsupported
- Partial
- Unknown
- Degraded
- Failed

不得把未知能力视为已支持。

### 第三十五条：Intent → Capability → Execution Plan

平台统一采用：

```
User / Flow
    ↓
Intent
    ↓
Policy Evaluation
    ↓
Capability Matching
    ↓
Candidate Drivers
    ↓
Execution Plan
    ↓
Selected Driver
    ↓
Execution
```

平台首先根据硬性要求淘汰不满足必要能力的 Driver，再根据可解释的能力匹配、平台兼容性、当前健康状态和用户设置形成候选集。

不得因为某个内核“默认更常用”而绕过能力验证。

### 第三十六条：禁止不可解释的内核评分

平台不得建立无法解释、无法验证的“内核总分”并据此偷偷决定网络行为。

调度依据应能够说明：

- Intent 要求什么
- 哪些 Driver 满足要求
- 哪些 Driver 不满足
- 哪些能力为 Partial / Unknown
- 为什么进入候选集
- 为什么最终选定某 Driver
- 是否存在用户固定限制
- 是否启用了自动故障转移
- 执行结果如何

涉及重要网络行为时，自动选择必须可见、可关闭、可固定。

### 第三十七条：用户拥有 Driver 选择权

平台至少应支持以下选择语义：

```
Automatic
Fixed Driver
Allowed Drivers
Disable Automatic Failover
Allow Automatic Failover
```

自动模式下平台可以根据 Intent 与 Capability Registry 选择最适配的 Driver。

固定模式下平台不得擅自切换到其他 Driver。

用户明确禁止自动故障转移时，失败不得偷偷转移到其他执行后端。

### 第三十八条：故障转移必须重新验证

Driver 出现：

- 启动失败
- 能力失效
- 连接失败
- 协议失败
- 传输失败
- 健康状态恶化
- 平台能力变化

时，平台可以根据用户授权的 Failover Policy 重新执行：

```
Failure
 ↓
Revalidate Intent
 ↓
Revalidate Capability
 ↓
Rebuild Candidate Set
 ↓
Create New Execution Plan
 ↓
User Policy Allows?
 ↓
Failover / Fail Closed
```

不得把“换一个内核”视为无条件安全的操作。

### 第三十九条：Session 边界必须明确

Driver 调度以 Session / Connection 为基本执行边界。

必须区分：

- New Connection
- Existing Session
- Stream
- Pipeline / Chain

一般情况下，Driver 切换应作用于新建连接。

除非能够证明底层协议和运行时支持安全迁移，否则不得宣称已有连接能够无损迁移到另一个 Driver。

### 第四十条：统一接口不应抹平原生能力

如果某个 Driver 提供统一标准之外的原生能力，平台应采用：

```
Unified Capability
        +
Native Extension
```

的方式接入。

原生扩展必须：

- 明确归属
- 明确能力范围
- 明确平台限制
- 明确版本要求
- 明确是否影响跨平台一致性
- 不得污染 Canonical Model
- 不得夺取平台全局策略决定权

因此：

> **统一标准负责共同语义，原生扩展负责差异能力。**

### 第四十一条：平台不应重复实现内核协议执行能力

平台统一策略和意图，不意味着 AngelaNexus 必须重新实现所有协议、加密、握手、传输和底层连接机制。

原则上：

```
Platform
  ↓
Intent / Policy / Execution Plan
  ↓
Driver
  ↓
Protocol / Transport Execution
```

平台只有在具有明确架构收益、可验证性和长期维护能力时，才逐步吸收某项执行能力。

不得为了“统一”而制造重复实现。

### 第四十二条：三内核是可替换执行平面

Mihomo、sing-box、Xray 的长期定位为：

> **可替换、可协商、可调度的 Protocol / Transport Execution Plane。**

它们不是 AngelaNexus 的大脑。

平台负责：

- 判断意图
- 计算策略
- 匹配能力
- 生成执行计划
- 选择 Driver
- 管理 Session
- 处理安全边界
- 处理故障与恢复

Driver 负责：

- 接收平台授权
- 转换统一模型
- 调用对应执行能力
- 返回执行状态
- 返回可验证结果

### 第四十三条：新增执行后端不得改变平台核心架构

未来增加第四、第五个执行后端时，不得通过：

```
Mihomo ↔ sing-box ↔ Xray ↔ New Backend
```

形成点对点耦合。

必须通过：

```
                 Unified Standard
                /      |      |      \
           Mihomo   sing-box   Xray   New Backend
             \        |       |       /
                 Driver Layer
```

接入。

新增 Driver 原则上只需要实现统一接口、能力声明和必要适配，不得要求平台核心为其建立新的全局分支。

### 第四十四条：性能与资源约束

三内核待命机制不得演变为三份完整运行时长期高负载运行。

平台必须区分：

- Installed
- Available
- Ready
- Active
- Idle
- Suspended
- Unavailable

根据平台资源、系统生命周期和用户设置，可以采用：

- 按需启动
- 预热
- 保活
- 挂起
- 释放

等策略。

任何优化不得违反：

- 用户控制
- 安全边界
- Fail Closed
- Session 正确性
- 跨平台一致性

### 第四十五条：统一调度的最终定义

AngelaNexus 的三内核调度模型正式定义为：

> **三个执行内核平行存在、能力可探测、统一接收平台意图；平台通过 Capability Registry 对候选执行后端进行能力协商和策略匹配，为每个 Session 生成可解释的 Execution Plan，由最适配且获得授权的 Driver 执行；内核之间不通过简单轮询决定任务，也不得成为平台全局策略中心。**

最终架构关系：

```
                    AngelaNexus
                         │
                    User / Flow
                         │
                         ▼
                  Unified Intent
                         │
                         ▼
                 Policy / Security
                         │
                         ▼
               Capability Registry
                         │
                         ▼
                Driver Scheduler
                         │
             ┌───────────┼───────────┐
             ▼           ▼           ▼
          Mihomo      sing-box      Xray
          Driver       Driver       Driver
             │           │           │
             └───────────┼───────────┘
                         ▼
              Protocol / Transport
                    Execution
                         │
                         ▼
                      Network
```

其核心原则归纳为：

> **平台统一意图，策略统一表达，能力统一声明，调度统一决策，Driver 负责翻译，内核负责执行；三内核平行待命、按能力协商，不以简单轮询为核心调度机制。**

## 第二十三章：纲领附件变更控制

### 第四十六条：架构共识必须进入纲领附件

凡经确认并影响 AngelaNexus 长期架构边界的重大共识，应在实施代码之前进入本纲领或正式纲领附件。

纲领附件不得与主纲领产生相互矛盾的架构定义。

### 第四十七条：附件内容必须经过实现前审计

新增架构原则进入实施阶段前，必须核查：

- 是否与 Platform First 一致
- 是否保持三内核平行
- 是否保持 Canonical Model
- 是否保持用户最终控制权
- 是否保持 Fail Closed
- 是否破坏跨平台
- 是否造成 Backend Lock-in
- 是否引入不可解释的自动决策
- 是否造成不必要的资源消耗
- 是否可以通过测试和事实依据验证

通过后方可进入代码实现。

