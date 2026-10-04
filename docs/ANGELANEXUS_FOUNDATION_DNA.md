# AngelaNexus Foundation DNA（纲领之基基因）

项目：AngelaNexus
定位：智能网络代理平台
DNA 版本：AN-DNA v1

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
1. DNA 清单只描述继承关系。
2. Foundation Gate 保存独立的根锚验证条件。
3. Foundation Gate 必须受到独立于普通代码提交的治理保护。
4. GitHub Required Status Check、Code Owner 审查和分支/Ruleset 保护负责形成实际权限约束。
5. 后续应使用仓库外部或不可由单一维护者单方面修改的密码学信任锚，对 Foundation Root、DNA 与继承证书进行签名。

## 六、Fork 与后继项目
继续主张 AngelaNexus 身份的 Fork 或衍生项目必须携带 Foundation Root ID、Foundation DNA ID、父项目身份、当前项目身份、继承声明以及可验证的 Foundation Gate 结果。
复制关系可以存在，但不能自动获得 AngelaNexus 的正式继承身份。

## 七、不可伪造边界
拥有仓库权限 ≠ 获得 Foundation DNA
拥有管理员权限 ≠ 获得 Foundation DNA
创建 Fork ≠ 获得 Foundation DNA
复制代码 ≠ 获得 Foundation DNA
删除 DNA 文件 ≠ 解除 Foundation 继承义务

## 八、最终原则
只要一个主体仍然属于 AngelaNexus 的项目继承链，它就必须与 Foundation DNA 一起存在；任何利益方，包括创建者本人，都没有法外豁免。
Foundation DNA PASS 只证明身份、继承与纲领一致性满足机器门槛，不自动授予代码合并、治理或发布权限。