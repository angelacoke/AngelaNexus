# 致谢与鸣谢

AngelaNexus 的设计、实现、验证和长期维护建立在开放标准、开源软件、上游项目、开发工具以及社区公开资料的基础上。项目对以下工作表示感谢。

## 当前直接使用或已在项目清单中记录的开源组件

### js-yaml

AngelaNexus 当前 JavaScript 依赖中使用 js-yaml，用于 YAML 相关处理。

- 项目：https://github.com/nodeca/js-yaml
- 许可证：MIT
- 具体版本与完整依赖树以项目锁定文件、构建结果和发布时的依赖清单为准。

### AndroidX / Jetpack Compose

AngelaNexus Android 应用使用 AndroidX / Jetpack Compose 相关组件构建原生 Android UI 与应用能力。

- 项目：https://developer.android.com/jetpack
- 许可证及版权声明：以对应 AndroidX / Jetpack 发布包随附的许可证和 NOTICE 为准。
- 发布版本必须保留适用的第三方版权和许可证信息。

## 上游内核与生态项目

AngelaNexus 的核心架构面向 Mihomo、sing-box、Xray 等代理内核，并持续以其公开源码、配置规范、API、测试体系和发布信息作为兼容性研究与实现依据。

当前仓库中的相关内容不应被理解为已经内置或重新分发这些上游运行时。只有当某一具体上游版本、提交或构建产物实际进入 AngelaNexus 发布物时，才应在发布级第三方清单中记录该精确来源、许可证、版权声明和 NOTICE 要求。

- Mihomo：https://github.com/MetaCubeX/mihomo
- sing-box：https://github.com/SagerNet/sing-box
- Xray-core：https://github.com/XTLS/Xray-core

## 开源标准与许可证

感谢 Apache Software Foundation 对 Apache License 2.0 的维护，以及整个开源社区对规范化许可证、版权声明和第三方归属实践的长期建设。

AngelaNexus 自有代码的许可证政策见 [LICENSE](../LICENSE)、[LICENSE_POLICY.md](legal/LICENSE_POLICY.md) 和 [THIRD_PARTY_LICENSES.md](legal/THIRD_PARTY_LICENSES.md)。

## 社区与贡献者

感谢所有通过公开 issue、讨论、代码、测试、错误报告、兼容性反馈、文档和技术研究帮助改进代理生态及跨平台网络软件的人。

对于尚未逐项列出的个人贡献者、社区维护者、测试者和资料提供者，AngelaNexus 保留在后续版本中根据实际贡献补充致谢名单的空间。

## 致谢原则

1. 不将第三方项目或个人贡献误表述为 AngelaNexus 的原创成果。
2. 不因致谢而改变第三方项目原有许可证、版权或商标权利。
3. 实际随发布物分发的第三方组件，以发布时核验的精确版本、提交、许可证和 NOTICE 为准。
4. 对未来新增内核、库、SDK、工具链和数据源，在进入正式发布物前完成归属与许可证核验。
