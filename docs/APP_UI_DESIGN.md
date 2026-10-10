# AngelaNexus APP UI Design Baseline

## Product scope

This UI specification applies to Android, iOS, Windows, macOS and Linux. Android is the first executable UI surface. Information architecture, semantic states and user concepts are shared across platforms.

## Direction

AngelaNexus uses a modern, modular, adaptive interface with compact cards, clear primary actions, light/dark themes and explicit separation between home, configuration, proxy, rules and settings. The implementation remains independently structured around the AngelaNexus Core/Kernel architecture.

## Shared UI boundary

Shared UI is responsible for navigation, runtime state presentation, configuration/import flows, proxy/node/strategy views, routing/security visualization, GFW observation, diagnostics/logs, account/data state, backup/restore and preferences.

Platform shells are responsible for VPN/TUN, system proxy, permissions, background lifecycle, notifications, secure storage, network interfaces, system tray/menu bar, native file pickers and OS-specific firewall/routing APIs.

Shared UI must not directly import platform-specific APIs.

## Primary navigation

1. **首页** — connection state, traffic, environment, quick actions and runtime state.
2. **配置** — subscriptions, local files, single nodes and multi-node imports.
3. **代理** — nodes, selectors, chains and kernel-independent proxy views.
4. **规则** — routing, anti-leak, China-network optimization and GFW-aware policy visibility.
5. **设置** — account/data, backup/restore, platform settings, security, kernel diagnostics and appearance.

## Account and data

Settings contains account identity, synchronization status, backup history, backup creation, restoration, selective restoration, conflict resolution, synchronization scope and device list.

The UI clearly distinguishes:
- **shared account data** — portable across platforms;
- **platform state** — interpreted by each platform independently;
- **device-only secrets** — never included in ordinary synchronization or backup.

Successful synchronization must never be presented as successful proxy start or VPN/TUN activation.

## Adaptive layout

### Phone
Use bottom navigation for the five primary modules.

### Tablet
Use adaptive navigation rail or a two-column layout with persistent module navigation.

### Windows / macOS / Linux
Use a sidebar with a central workspace and optional detail panel. Support keyboard shortcuts, context menus, resizable windows and tray/menu-bar surfaces. Desktop is not a scaled-up phone layout.

## UI principles

- **Modular:** reusable semantic modules; core policy is not duplicated in UI code.
- **State-driven:** UI reflects Core/account/platform state.
- **Progressive disclosure:** simple controls first; advanced routing, security, synchronization and diagnostics remain accessible without clutter.
- **Security-visible:** anti-leak, route mode, VPN state, DNS state and GFW-related decisions are observable.
- **Data-boundary-visible:** users can see what is shared, platform-local and device-only.
- **Low resource use:** avoid persistent animations and unnecessary polling; status views subscribe to shared state.
- **Adaptive:** responsive containers preserve the same semantics across screen sizes.
- **Accessible:** touch targets, dynamic text sizing, keyboard navigation, semantic labels and sufficient contrast.
- **Theme-aware:** follow system light/dark mode and platform appearance capabilities.
- **Platform-native where necessary:** shared semantics do not force identical OS controls where native mechanisms are materially better.

## Home layout

The home screen remains compact:
- app identity and Core status;
- primary connection card;
- upload/download/session metrics;
- environment/security summary;
- synchronization indicator;
- quick actions;
- runtime diagnostics.

The connection card must never claim active proxy traffic until the Core reports an active execution state.

The connection workflow must preserve the same evidence boundary:
- Start is an explicit user action and is enabled only when Core returns a complete, valid platform handoff.
- Stop remains available while the runtime is starting or running; if cleanup cannot be verified, reconnect stays blocked until cleanup succeeds.
- A measured zero is different from unavailable telemetry. Never display hard-coded zero traffic as a live measurement.
- Routing, anti-leak, DNS and GFW status must be labeled unreported or unverified until the runtime exposes evidence for them.

## Configuration UX

The user can provide:
- subscription URL;
- local configuration file;
- one node;
- multiple nodes, including mixed formats.

The UI hands input to the Core import/sniffing pipeline and does not require manual kernel selection when Core detection is available.

### Android local Profile persistence

- An imported configuration is temporary until the user explicitly saves it as a local Profile.
- Saved names, selection metadata and Core configuration are authenticated-encrypted with an Android Keystore key and stored outside device backup. This MVP does not upload or synchronize profile contents.
- Startup restoration and every Profile selection must re-enter Core import/validation; a saved file is not proof that its configuration remains valid or executable.
- Profile editing, deletion and switching are disabled while VPN execution or cleanup is active. Deletion requires explicit confirmation.
- This Android storage boundary does not redefine the cross-platform shared Profile model; future synchronization must use an explicit schema and field-level data classification.

## Backup/restore UX

Backup and restore are explicit user actions. Restore shows a preview before destructive changes and supports selective restoration where the data model permits it.

Restore order:
1. validate account and backup identity;
2. validate schema/version;
3. preview changes;
4. restore shared account data;
5. apply only supported platform state;
6. re-run Core validation/security checks;
7. report unsupported platform fields without claiming they were applied.

## Proxy UX

Proxy views are kernel-neutral. Common node fields are exposed when Core can safely project them; kernel-specific capabilities are optional details. Chain composition is represented as a graph/list of outbound stages rather than fixed role names.

### Android import preview boundary

- The Android Proxies screen may show only the bounded, credential-free Core node summary fields: name, protocol, server and port.
- The Core projection is display-only and must not be used to select a node, compile a route or imply that a proxy is active.
- If Core omits node details, the UI says they were not provided. If Core truncates the list, the UI identifies the shown count and total; it must not imply that the preview is complete.
- Credentials, tokens, UUIDs and other configuration secrets must never be copied into node-summary UI data.
- Live selection, health, latency and traffic remain unavailable until independently implemented and verified.

## Rules UX

Rules are grouped by intent:
- network routing;
- privacy / anti-leak;
- China-network optimization;
- AI/service routing;
- GFW observation and response;
- user overrides.

The UI displays the effective decision and available evidence source; it does not silently rewrite user policy.

## Implementation status

The UI specification is a design baseline, not proof of production runtime execution. Production cloud authentication, cloud storage, proxy execution and platform-native runtime integration require separate implementation and verification milestones.
