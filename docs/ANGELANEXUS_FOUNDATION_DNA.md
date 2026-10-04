# AngelaNexus Foundation DNA（纲领之基基因）

项目：AngelaNexus
定位：智能网络代理平台
DNA 版本：AN-DNA v2 / Gene v1

## 一、定义

Foundation DNA 是 AngelaNexus 项目身份、纲领继承关系与**项目基因契约**的机器可验证载体。

它的核心目的不是建立一个越来越多的权限锁，而是让纲领之基自然成为项目的共同遗传根：

`Foundation → DNA → Inheritance → Architecture / Product / Development / Security / Release`

技术实现可以自由演进，只要仍然与 DNA 中定义的根本目标兼容。

## 二、项目基因，而非外部权威

Foundation DNA 固化的是三类内容：

1. **不可丢失的根本目标**：项目初衷、用户选择与控制、纲领之基的最高地位；
2. **可演进的实现边界**：架构、技术栈、内核、平台、UI、CI、发布方式均可变化；
3. **继承契约**：Fork、迁移、重构、拆分和版本演进默认继承基因，不因工程形式变化而自动失效。

因此：

> **Foundation 约束项目的方向，而不是把项目的每一个动作都锁死。**

## 三、继承关系

AngelaNexus Foundation Root → Foundation DNA → Inheritance → Architecture / Product / Development / Security / Release

后继项目默认继承 DNA。Fork、迁移、重命名或技术替换本身不是豁免理由；同时，普通实现变化也不需要重新获得“根本原则批准”。

## 四、当前根锚
Foundation Root：docs/ANGELANEXUS_FOUNDATION.md
Git Blob SHA：4f047d7a53ef7db1d18174916ea9ed5cacbd8133
DNA ID：sha256(AngelaNexus|FOUNDATION|4f047d7a53ef7db1d18174916ea9ed5cacbd8133|v1)
当前 DNA ID：da14d8750b5f8af9a41902b752dca6dcc8930bb866fdbc44b493c2a646e22c8e

## 五、信任边界

DNA 文件本身不能成为自己的信任根。

1. DNA 清单负责表达项目基因与继承契约；
2. Foundation Gate / Gene Verifier 负责验证当前实现是否仍与基因兼容；
3. GitHub Required Status Check、Ruleset、Code Owner 等属于工程保护手段，不是新的最高原则；
4. 外部锚定可以作为额外的独立证据，但不是 AngelaNexus 项目基因成立的前提；
5. 外部锚定不得获得修改、解释或替代纲领之基的权力。

## 六、Fork 与后继项目

继续主张 AngelaNexus 身份的 Fork 或衍生项目默认继承 Foundation DNA。

它们可以自由改变：

- 技术栈；
- 架构实现；
- 平台；
- 执行后端；
- UI；
- 工程流程。

但必须保留根本目标兼容性。Fork 不是豁免机制，也不是重新定义项目根本目标的机制。

## 七、变化分类

普通实现变化属于正常演进：

Implementation / Structural Change → Gene Compatibility Verification → Continue

只有真正触及项目根本目标的变化才属于：

Root Goal Change → Constitutional Process

因此，CI 不应因为“实现不同”而阻止项目演进，而应识别是否发生了根本方向冲突。

## 八、最终原则

只要一个主体仍然属于 AngelaNexus 的项目继承链，它就默认携带 Foundation Gene。

**Foundation 是项目的基因，不是项目的枷锁。**

Foundation Gate PASS 表示当前变更与项目基因兼容；它不等于治理批准，也不授予代码合并、治理或发布权限。
