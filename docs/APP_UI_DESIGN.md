# AngelaNexus APP UI Design Baseline

## Direction

AngelaNexus adopts a modern, modular Material 3 interface. FlClash is used as a reference for several interaction principles rather than copied as a visual implementation: adaptive layouts, Material You styling, light/dark themes, bottom navigation, compact cards, and a clear separation between proxy/profile/settings areas.

Reference: FlClash publicly describes adaptive screen sizes, multiple color themes, Material You Design and a Surfboard-like UI. Its current repository and release history also show continued UI/app-layer rework. The AngelaNexus implementation remains independently structured around its own Core/Kernel architecture.

## Primary navigation

1. **首页** — connection state, traffic, environment, quick actions and runtime state.
2. **配置** — subscriptions, local files, single nodes and multi-node imports.
3. **代理** — nodes, selectors, chains and kernel-independent proxy views.
4. **规则** — routing, anti-leak, China-network optimization and GFW-aware policy visibility.
5. **设置** — platform settings, security, kernel selection/diagnostics and appearance.

## UI principles

- **Modular:** each page is a composable module; core policy is never duplicated in UI code.
- **State-driven:** UI reflects Core state instead of inventing its own proxy/runtime state.
- **Progressive disclosure:** simple controls first; advanced routing, security and kernel diagnostics remain accessible without cluttering the home screen.
- **Security-visible:** anti-leak, route mode, VPN state, DNS state and GFW-related decisions are observable.
- **Low resource use:** avoid persistent animations and unnecessary polling; traffic/status widgets should subscribe to a shared state stream.
- **Adaptive:** phone, tablet and desktop layouts should use the same semantic components with responsive containers.
- **Accessible:** minimum touch targets, dynamic text sizing, semantic labels and sufficient contrast.
- **Theme-aware:** follow system light/dark mode first; support platform dynamic colors where available.

## Home layout

The home screen is intentionally compact:

- top app identity and Core status;
- primary connection card;
- upload/download/session metrics;
- environment/security summary;
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

The first Compose implementation is intentionally a functional visual baseline. It establishes the navigation shell, modular pages, Material 3 theme, dynamic color, dark-mode support, brand integration and clear placeholders for Core-connected state.

It does not yet claim production proxy execution, because Android kernel integration and Core-to-UI state bridging are still separate milestones.
