# AngelaNexus APP UI Design Baseline

## Product scope

This UI specification applies to the full AngelaNexus APP product:

- Android
- iOS
- Windows
- macOS
- Linux

Android is only the first executable UI surface. The information architecture, semantic states and user concepts are shared across platforms.

## Direction

AngelaNexus adopts a modern, modular Material 3 interface. FlClash is used as a reference for interaction principles rather than copied as a visual implementation: adaptive layouts, Material You styling, light/dark themes, bottom navigation, compact cards, and clear separation between proxy/profile/settings areas.

The implementation remains independently structured around the AngelaNexus Core/Kernel architecture.

## Shared UI boundary

Shared UI is responsible for:

- navigation and page composition;
- connection/runtime state presentation;
- configuration and import flows;
- proxy/node/strategy views;
- routing and security policy visualization;
- GFW observation and response visibility;
- diagnostics and logs;
- account and cloud-sync status;
- backup and restore flows;
- user preferences and appearance.

Platform shells are responsible for OS capabilities:

- VPN/TUN;
- system proxy;
- permissions;
- background lifecycle;
- notifications;
- secure storage;
- network interfaces;
- system tray/menu bar;
- native file/document pickers;
- OS-specific firewall/routing APIs.

Shared UI must not directly import Android, iOS, Windows, macOS or Linux APIs.

## Primary navigation

1. **首页** — connection state, traffic, environment, quick actions and runtime state.
2. **配置** — subscriptions, local files, single nodes and multi-node imports.
3. **代理** — nodes, selectors, chains and kernel-independent proxy views.
4. **规则** — routing, anti-leak, China-network optimization and GFW-aware policy visibility.
5. **设置** — account/cloud sync, backup/restore, platform settings, security, kernel diagnostics and appearance.

## Account and data module

Settings contains a dedicated **账户与数据** section:

- account identity;
- cloud sync status;
- last synchronization time;
- backup history;
- create backup;
- restore from cloud;
- restore from local file;
- selective restore;
- conflict resolution;
- synced-data scope;
- device list.

The UI must clearly distinguish:

- **shared account data** — portable across all platforms;
- **platform state** — interpreted by each platform independently;
- **device-only secrets** — never included in ordinary cloud synchronization or backup.

A successful cloud sync must never be presented as a successful proxy start or VPN/TUN activation.

## Adaptive layout

### Phone

Bottom navigation is used for the five primary modules.

### Tablet

Use an adaptive navigation rail or two-column layout with persistent module navigation.

### Windows / macOS / Linux

Use a desktop navigation rail/sidebar with a central workspace and optional detail panel. Desktop-specific interactions include keyboard shortcuts, context menus, resizable windows and tray/menu-bar surfaces.

Desktop is not a scaled-up phone layout.

## UI principles

- **Modular:** each page is a reusable semantic module; core policy is never duplicated in UI code.
- **State-driven:** UI reflects Core/account/platform state instead of inventing its own proxy/runtime state.
- **Progressive disclosure:** simple controls first; advanced routing, security, synchronization and kernel diagnostics remain accessible without cluttering the home screen.
- **Security-visible:** anti-leak, route mode, VPN state, DNS state and GFW-related decisions are observable.
- **Data-boundary-visible:** users can see what is shared to their account, what remains platform-local, and what is device-only.
- **Low resource use:** avoid persistent animations and unnecessary polling; traffic/status widgets should subscribe to shared state streams.
- **Adaptive:** phone, tablet and desktop layouts use the same semantic components with responsive containers.
- **Accessible:** minimum touch targets, dynamic text sizing, keyboard navigation on desktop, semantic labels and sufficient contrast.
- **Theme-aware:** follow system light/dark mode first; support platform dynamic colors where available.
- **Platform-native where necessary:** shared semantics do not force identical OS controls where the platform has a materially better native mechanism.

## Home layout

The home screen is intentionally compact:

- top app identity and Core status;
- primary connection card;
- upload/download/session metrics;
- environment/security summary;
- compact cloud-sync indicator;
- quick actions;
- runtime diagnostics.

The connection card is the dominant interaction surface. It must never claim that traffic is proxied until the Core reports an active execution state.

## Configuration UX

The import flow is intentionally unified. The user can provide:

- subscription URL;
- local configuration file;
- one node;
- multiple nodes, including mixed formats.

The UI should hand the input to the Core import/sniffing pipeline. It should not ask the user to manually choose Mihomo, sing-box or Xray when the Core can determine the format.

## Backup/restore UX

Backup and restore are explicit user actions. Restore must show a preview before destructive changes and must support selective restoration where the data model permits it.

Restore order:

1. validate account and backup identity;
2. validate schema/version;
3. preview changes;
4. restore shared account data;
5. apply only supported platform state;
6. re-run Core validation/security checks;
7. report unsupported platform fields without pretending they were applied.

## Proxy UX

Proxy views are kernel-neutral. A node should expose common fields while kernel-specific capabilities are shown as optional details. Chain composition is represented as a graph/list of outbound stages rather than hard-coded entry/relay/exit roles.

## Rules UX

Rules are grouped by intent rather than kernel syntax:

- network routing;
- privacy / anti-leak;
- China-network optimization;
- AI/service routing;
- GFW observation and response;
- user overrides.

The UI displays the effective decision and evidence source where available; it does not silently rewrite user policy.

## Current implementation

The first Android implementation establishes a functional Material 3 visual baseline. Shared account-sync and backup contracts now exist in the Core layer. The next UI milestone is extraction of reusable semantic components and state contracts into the cross-platform UI layer and wiring the account/data screens to those contracts.

It does not yet claim production cloud authentication, cloud storage, or production proxy execution. Those require their own implementation and verification milestones.
