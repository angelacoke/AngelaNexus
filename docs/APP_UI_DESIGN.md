# AngelaNexus APP UI Design Baseline

## Product scope

This UI specification applies to Android, iOS, Windows, macOS and Linux. Android is the first executable UI surface. Information architecture, semantic states and user concepts are shared across platforms.

## Supported UI languages

The APP is designed as a four-language product:

| Locale | Display name | Direction | Role |
|---|---|---|---|
| en | English | LTR | Primary / default |
| zh-CN | 简体中文 | LTR | First-class |
| ru | Русский | LTR | First-class |
| fa | فارسی | RTL | First-class |

Language selection is an explicit user setting and must not change routing, security, DNS, GFW, protocol, transport, or execution-backend semantics. Platform language can be used as the initial suggestion, with deterministic English fallback.

## Direction

AngelaNexus uses a modern, modular, adaptive interface with compact cards, clear primary actions, light/dark themes and explicit separation between home, configuration, proxy, rules and settings.

## Shared UI boundary

Shared UI is responsible for navigation, runtime state presentation, configuration/import flows, proxy/node/strategy views, routing/security visualization, GFW observation, diagnostics/logs, account/data state, backup/restore and preferences.

Platform shells are responsible for VPN/TUN, system proxy, permissions, background lifecycle, notifications, secure storage, network interfaces, system tray/menu bar, native file pickers and OS-specific firewall/routing APIs.

Shared UI must not directly import platform-specific APIs.

## Primary navigation

1. **Home** — connection state, traffic, environment, quick actions and runtime state.
2. **Configuration** — subscriptions, local files, single nodes and multi-node imports.
3. **Proxy** — nodes, selectors, chains and kernel-independent proxy views.
4. **Rules** — routing, anti-leak, China-network optimization and GFW-aware policy visibility.
5. **Settings** — account/data, backup/restore, platform settings, security, diagnostics and appearance.

## Localization UX

The language selector must expose all four supported languages using their native names:

- English
- 简体中文
- Русский
- فارسی

The selector must remain accessible from Settings. Changing language must not reset configuration, routing policies, security preferences, account state, backups, or runtime state.

Persian requires RTL-aware layout, including navigation order, text alignment, icons that convey direction, dialogs, lists and mixed LTR technical identifiers. Technical identifiers such as domains, URLs, IP addresses, protocol names and version strings remain LTR-safe.

## Account and data

Settings contains account identity, synchronization status, backup history, backup creation, restoration, selective restoration, conflict resolution, synchronization scope and device list.

The UI clearly distinguishes shared account data, platform state and device-only secrets.

Successful synchronization must never be presented as successful proxy start or VPN/TUN activation.

## Adaptive layout

### Phone
Use bottom navigation for the five primary modules.

### Tablet
Use adaptive navigation rail or a two-column layout with persistent module navigation.

### Windows / macOS / Linux
Use a sidebar with a central workspace and optional detail panel. Support keyboard shortcuts, context menus, resizable windows and tray/menu-bar surfaces. Desktop is not a scaled-up phone layout.

## UI principles

- Modular
- State-driven
- Progressive disclosure
- Security-visible
- Data-boundary-visible
- Low resource use
- Adaptive
- Accessible
- Theme-aware
- Platform-native where necessary
- Localization-ready
- RTL-safe

## Implementation status

The UI specification is a design baseline, not proof of production runtime execution. Each platform and each locale requires implementation and build/runtime verification before being marked production-ready.
