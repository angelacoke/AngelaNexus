# AngelaNexus Platform Architecture

AngelaNexus is a real cross-platform proxy application from the first architectural layer.

## Target platforms

- Android
- iOS
- Windows
- macOS
- Linux

No platform is the architectural primary target. Platform-specific capabilities are exposed through contracts and implemented independently.

## Runtime layers

~~~text
AngelaNexus UI
   |
Application / Orchestration
   |
Platform-neutral Core
   |-- canonical node / flow / pipeline model
   |-- configuration / import
   |-- explicit routing policy
   |-- strategy groups
   |-- chain
   |-- DNS/security policy
   |-- health/self-healing
   |-- resource policy / telemetry
   |
Protocol Adapter Layer
   |-- protocol identification / capability contract
   |-- explicit capability negotiation
   |-- protocol-neutral runtime descriptors
   |
Transport Abstraction
   |-- stream / datagram transport contracts
   |-- transport capability negotiation
   |
Execution Backend Layer
   |-- compatibility backend adapters
   |-- Mihomo
   |-- sing-box
   |-- Xray
   |
Platform Contract
   |-- TUN/VPN
   |-- system proxy
   |-- process/application exclusion
   |-- network state
   |-- lifecycle
   |-- notifications
   |-- secure storage
   |
Native Platform Implementation
   |-- Android
   |-- iOS
   |-- Windows
   |-- macOS
   `-- Linux
~~~

## Platform control-plane integration

The platform-neutral execution path is now represented by a concrete control-plane contract:

~~~text
Identity / request context
        |
Device Policy Engine
        |
Route Decision (direct / proxy / block / chain)
        |
Network Control Plane
        |------------------|
Network Lifecycle   Network Acceptance Harness
        |------------------|
        |
Kernel / platform adapters
~~~

The control plane is responsible for orchestration, not packet execution. It propagates the deterministic policy decision into the injected kernel adapter, gates execution through capability and user/security checks, records lifecycle evidence, and requires live verification plus traffic acceptance before entering the running state. Rejected or failed operations do not silently downgrade policy; failures return explicit evidence and use recovery/cleanup verification before restoration.

The implementation is platform-neutral in `src/platform/network-control-plane.js`. Android, iOS, Windows, macOS and Linux implementations remain adapter responsibilities.

## Unified capability center

The primary UI must expose common behavior once. Users should not need separate Mihomo, sing-box and Xray operating concepts.

A user-visible policy such as:

~~~text
Google -> US
Domestic -> bypass
AI -> AI strategy
Telegram -> fallback
Default -> auto-select
~~~

is represented once in the kernel-neutral routing model and compiled by the selected adapter.

The adapters are responsible for expressing that policy in native configuration and APIs. They must not redefine the user's operating model.

## Explicit capability differences

Unified behavior does not mean pretending that kernels or platforms are identical.

For every feature AngelaNexus must distinguish:

- supported and directly compilable;
- supported with a different native mechanism;
- partially supported;
- unavailable;
- unknown / not yet verified.

A non-equivalent feature must never be silently dropped or changed into a different policy. AngelaNexus should expose the limitation and let the user choose an alternative.

## Resource-efficiency boundary

Resource optimization belongs in the core policy layer, but resource measurements remain runtime-specific.

The core may coordinate:

- adaptive health-check frequency;
- event-driven state observation;
- bounded telemetry/log/cache retention;
- scheduled rule-set refresh;
- idle/low-power reductions;
- prevention of duplicate kernel runtimes.

Kernel adapters expose measurable runtime state where the upstream kernel provides it. Platform implementations expose battery/background constraints where the OS permits it.

Security, fail-closed behavior and routing correctness take precedence over resource savings.

## Non-negotiable boundary

The core must not import Android, iOS, Windows, macOS or Linux APIs.

Platform implementations may depend on native APIs, but the reverse dependency is forbidden.

## Real-world constraints

Platform capabilities are not assumed to be identical.

- Android VPN integration is based on Android VpnService and the selected kernel's supported embedding interface.
- Apple transparent proxying requires Network Extension / platform-specific service integration; iOS and macOS capabilities differ.
- Windows transparent proxying can require WFP/TUN integration and elevated installation/service capabilities.
- Linux integration may use TUN plus routing/iproute2 or firewall facilities.
- System proxy support is an optional platform capability and is not equivalent to TUN/VPN.

Feature availability must be capability-driven, not hard-coded as if all platforms were identical. Runtime requirements are negotiated explicitly against protocol, transport and execution-backend capabilities. Missing capabilities fail closed and are surfaced as unsupported rather than silently downgraded.

## Kernel policy

The core produces a backend-neutral runtime plan. Protocol and transport are resolved independently before an execution backend is selected. Kernel-specific configuration syntax remains inside compatibility adapters.

No kernel is a permanent production-primary target. Mihomo, sing-box and Xray remain compatibility execution backends; native or independent execution must be verified separately before production support is claimed.

## Evidence rule

A feature is considered implemented only when one of the following exists:

1. upstream source/API/schema proves the integration;
2. a reproducible build/test proves it;
3. a platform implementation is present and exercised.

Architectural placeholders must be explicitly marked as such and must not be presented as working features.