# Application-Scoped Routing

## Purpose

AngelaNexus treats application and process identity as first-class routing evidence. A rule may target an application or process without requiring system-wide interception.

## Identity model

Stable identifiers are platform-aware:

- Android: package name plus process name where available.
- iOS: bundle identifier plus platform-provided process/app identity.
- macOS: bundle identifier, executable and process path/name.
- Windows: executable/process name and normalized executable path.
- Linux: executable/process name and normalized executable path.

A runtime PID is ephemeral evidence. It may be recorded for diagnostics but must not become the persistent identity of a routing policy.

## Execution scopes

The policy engine can express:

1. application scope;
2. process scope;
3. connection/network scope.

Application-scoped proxying is a driver capability, not a replacement for TUN, system proxy, or transparent interception. A platform may use environment proxy variables when the target application honors them, a native per-app API, process redirection, or another verified mechanism.

## Decision flow

`Application/Process Identity → Routing Policy → Execution Plan → Capability Registry → Driver Scheduler → Platform Driver → Kernel Dialer`

The kernel remains a protocol/transport execution backend. It does not own application identity or platform interception policy.

## Security and observability

Application-scoped execution requires explicit user authorization and a visible scope. Drivers must not silently broaden an application/process plan into system-wide interception.

Every execution result should preserve:

- application/process identity evidence;
- selected scope;
- selected driver;
- selected kernel/backend;
- route decision;
- verification outcome.

Sensitive payloads, credentials and proxy secrets must not be written to the execution ledger.

## Borrowed design principle

ProxyLauncher demonstrates a useful narrow-scope pattern: launching a target application with proxy settings can affect that application without changing the whole system. AngelaNexus adopts the principle, not the implementation, and extends it into the cross-platform intent/policy/capability architecture.
