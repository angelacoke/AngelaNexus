# AngelaNexus Roadmap

## Product architecture principle

AngelaNexus is the unified capability and policy center:

- one user-facing UI and one operating model;
- one kernel-neutral routing/policy model;
- one capability model shared by Mihomo, sing-box and Xray;
- platform-specific and kernel-specific work stays behind adapters;
- automatic analysis may detect, validate, measure and diagnose, but policy-changing decisions remain explicit and user-controlled;
- common behavior is visible in AngelaNexus; implementation details are delegated to the appropriate kernel/platform component.

## Current foundation

- Kernel-neutral core and controller.
- First-class Mihomo, sing-box and Xray adapters.
- Automatic format sniffing and explicit kernel binding.
- Unified node model, subscription parsing and region grouping.
- Kernel-neutral chain model with adapter-specific compilation.
- Versioned upstream compatibility registry.
- Explicit unified routing-policy model.
- Explicit resource-efficiency policy model.
- System security policy with a mandatory fail-closed GFW resilience floor.
- Bounded GFW evidence runtime with time decay and clock-rollback handling.
- GFW evidence → path-trust invalidation and current-network-generation revalidation.
- Execution-contract security gate that independently revalidates the system security floor before kernel startup.
- Kernel-conformance and regression tests covering the three adapter targets.

## Unified routing scope

The routing layer is designed to expose common behavior consistently:

- rule / global modes;
- domain, IP/CIDR, port and network matching;
- GeoIP / domain-set and rule-set matching;
- application/process matching where the platform and kernel expose it;
- logical AND/OR/NOT conditions;
- explicit routing, DNS, bypass, reject and chain actions;
- selector, URL-test, fallback and load-balancing strategies where supported;
- rule ordering, conflict detection and rule-hit explanation;
- capability-aware compilation so unsupported or non-equivalent features are never silently degraded.

Kernel-specific differences remain visible through capability status and compile diagnostics rather than leaking different configuration concepts into the primary UI.

## GFW resilience scope

The GFW layer remains kernel-neutral and evidence-driven.

### Evidence
- DNS injection / poisoned destination
- TCP reset
- TLS/SNI failure
- QUIC initial failure
- active-probe suspicion
- residual blocking
- regional variance
- certificate anomaly
- bootstrap integrity failure
- clock anomaly
- unexpected route change

### Security behavior
- one weak observation is not sufficient to claim confirmed blocking;
- independent corroboration is required for confirmation;
- evidence is bounded and time-decayed;
- stale observations are ignored;
- clock rollback does not silently downgrade security;
- GFW invalidation propagates into path trust;
- path trust failure stops a running execution;
- stale GFW validation is rejected at execution-contract and path-generation gates;
- active probing requires explicit user choice;
- failure to satisfy the security floor is rejected before execution.

## Resource-efficiency design

Efficiency is a first-class requirement, especially for mobile and low-memory devices.

Nexus must prefer:

- event-driven observation over frequent polling;
- adaptive health checks rather than constant probing of idle nodes;
- bounded logs, caches and telemetry;
- scheduled rule-set refreshes rather than unnecessary background refreshes;
- one active kernel/runtime rather than duplicated kernel processes;
- reduced background work while the device is idle or under low-power conditions;
- security and routing correctness over resource savings.

Resource mode is an explicit user policy (`efficient`, `balanced`, `performance`, `custom`) rather than a hidden quality downgrade.

The system must measure actual CPU, memory, battery/background activity, connection counts and kernel-specific telemetry where available before making optimization claims.

## Next implementation targets

1. Schema-aware and version-aware validation for each kernel.
2. Protocol/feature capability registry with evidence and combination constraints.
3. Continuous upstream release detection and controlled adapter updates.
4. Real kernel integration tests against pinned upstream binaries/config validators.
5. TUN/VPN platform bridges and process exclusion across all five target platforms.
6. Unified routing compiler for Mihomo, sing-box and Xray.
7. Unified UI for explicit routing, strategies, DNS, chain, security, GFW and runtime state.
8. Resource telemetry and adaptive low-power behavior with reproducible benchmarks.
9. Rule-hit explanation, diagnostics and safe repair suggestions.
10. GFW probe orchestration and evidence collection across supported platforms, without hidden policy changes.

## Community-derived engineering constraints

Recent upstream issue/discussion reports show that resource behavior can regress across versions and workloads. Nexus therefore treats memory, goroutine/connection growth, TUN loopback, DNS processing, logging volume and health-probe frequency as observable runtime risks rather than assumptions.

These reports are signals for testing and telemetry, not proof that every device or version has the same behavior.

## Update policy

Upstream releases are detected automatically. A detected stable-version drift must trigger review of release notes, configuration schemas, protocol support, adapter compilers, fixtures and regression tests before the Nexus baseline is changed.

No kernel is the permanent primary kernel. Each kernel has an independent upstream baseline and adapter maintenance path.
