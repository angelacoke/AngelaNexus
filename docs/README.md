# AngelaNexus Documentation

AngelaNexus documentation is **English-first**. English is the canonical documentation language for architecture, APIs, implementation contracts, release records, and developer-facing specifications.

## Documentation languages

The product documentation and APP UI support the following four languages:

- **English (primary / default)**
- **简体中文 (Simplified Chinese)**
- **Русский (Russian)**
- **فارسی (Persian)**

The application language is independent from routing, security, protocol, or execution-backend semantics. Persian uses right-to-left layout.

## Core documentation

| Topic | English | 简体中文 |
|---|---|---|
| Constitutional architecture | [AN-Constitution](ANGELANEXUS_CONSTITUTION.md) | [中文纲领](zh-CN/ANGELANEXUS_CONSTITUTION.md) |
| Platform architecture | [Platform Architecture](PLATFORM_ARCHITECTURE.md) | [平台架构](zh-CN/PLATFORM_ARCHITECTURE.md) |
| Platform strategy | [Platform Strategy](APP_PLATFORM_STRATEGY.md) | [平台策略](zh-CN/APP_PLATFORM_STRATEGY.md) |
| UI design | [UI Design](APP_UI_DESIGN.md) | [UI 设计](zh-CN/APP_UI_DESIGN.md) |
| Product experience | [Product Experience](PRODUCT_EXPERIENCE_BASELINE.md) | [产品体验基线](zh-CN/PRODUCT_EXPERIENCE_BASELINE.md) |
| Account, sync and backup | [Account & Sync](APP_ACCOUNT_SYNC.md) | [账户与同步](zh-CN/APP_ACCOUNT_SYNC.md) |
| Project progress | [Progress](APP_PROGRESS.md) | [项目进度](zh-CN/APP_PROGRESS.md) |

## Localization policy

1. English is the primary and normative language.
2. Simplified Chinese, Russian, and Persian are first-class product UI locales.
3. Locale selection never changes platform policy semantics.
4. Translations must not introduce different product behavior.
5. Unsupported or missing translations fall back deterministically to English.
6. Technical identifiers, protocol names, API names, version numbers, and code symbols remain unchanged.
7. UI layout must support right-to-left rendering for Persian.

Language changes presentation only; it does not change AngelaNexus platform semantics.
