# AngelaNexus Application Identity Routing and Diagnostics

## Purpose

Application/process-aware routing exists to improve **routing precision and diagnosability**.

Application identity is a first-class routing context alongside destination, protocol, port, DNS, network state, and security policy. It is not a kernel-specific rule language.

The design must never trade false precision for apparent precision.

## 1. Canonical Application Identity

The platform-neutral identity model is:

ApplicationIdentity
  platform
  packageId / bundleId / appId
  processName
  executable
  uid
  pid (ephemeral)
  user / profile
  instance (when supported)
  evidence
  confidence
  observedAt

Fields are optional. Unsupported or unobserved fields remain null/unknown.

### Evidence

Every identity attribute that can affect routing must carry an evidence classification:

- OS_API
- KERNEL_API
- SOCKET_OWNER
- PROCESS_TABLE
- VPN_RUNTIME
- CONFIG_DECLARATION
- USER_ASSERTED
- INFERRED
- UNKNOWN

INFERRED must never be silently promoted to confirmed identity.

### Confidence

The platform distinguishes:

- CONFIRMED
- PROBABLE
- UNKNOWN
- UNSUPPORTED
- CONFLICT
- FAILED

A routing rule that requires confirmed application identity must not match a merely probable or unknown identity unless the user explicitly configured that behavior.

## 2. Multi-dimensional Matching

Application identity is one dimension of a complete Match Set:

Application
  +
Process
  +
Domain / SNI
  +
IP / CIDR
  +
Port
  +
Protocol
  +
DNS context
  +
Network type
  +
Security context

The platform evaluates applicable dimensions before producing an Execution Plan.

Rules are not encoded as APP -> kernel.

Instead:

Flow Identity
    ↓
Matcher
    ↓
Match Set
    ↓
Conflict Analysis
    ↓
Policy
    ↓
Routing Intent
    ↓
Capability Registry
    ↓
Driver Scheduler

The selected execution backend remains an implementation detail of the resulting Intent.

## 3. Precision Safety

### 3.1 No identity, no false match

If package/process ownership cannot be established, the platform must preserve UNKNOWN.

It must not:

- guess an application from destination;
- reuse a stale PID;
- assume one package from a shared UID without evidence;
- convert an unresolved process into a confirmed package;
- silently fall through as if the identity had been verified.

### 3.2 Shared UID

A UID may represent multiple packages. Therefore UID is an identity attribute, not automatically an application identity.

The platform must support:

UID
 ├── package A
 ├── package B
 └── package C

If the platform cannot disambiguate the actual package/process, the diagnostic result is CONFLICT or UNKNOWN.

### 3.3 Missing process information

Some traffic cannot be associated with a local process. This is normal for some platform/network paths and external traffic.

The system must distinguish:

- identity genuinely unavailable;
- lookup temporarily failed;
- platform does not support the lookup;
- traffic is not locally owned;
- identity was intentionally not requested.

These states must not be collapsed into one generic error.

### 3.4 Capability-aware identity lookup

Process/application lookup is performed only when required by:

- an active routing rule;
- an explicit user diagnostic request;
- a connection/request view that promises application identity;
- a platform health/verification operation.

If no active policy can consume process/application identity, the high-frequency path should not perform an unnecessary lookup.

This reduces CPU cost and avoids diagnostic log spam.

## 4. Routing Decision Evidence

Every explainable routing decision should have a bounded decision record:

RoutingDecision
  decisionId
  timestamp
  flowId
  applicationIdentity
  destination
  protocol
  networkContext
  candidateRules[]
  matchedRules[]
  rejectedRules[]
  conflictState
  selectedPolicy
  resultingIntent
  capabilityRequirements
  candidateDrivers[]
  selectedDriver
  outcome
  failureReason

A rejected rule should record a compact reason such as:

- APP_MATCH
- APP_MISMATCH
- APP_UNKNOWN
- PROCESS_MATCH
- PROCESS_UNSUPPORTED
- DOMAIN_MATCH
- DOMAIN_MISMATCH
- CONFLICT
- POLICY_DENIED
- CAPABILITY_MISSING
- DRIVER_UNAVAILABLE

The system must not emit full rule/config payloads for every flow.

## 5. Diagnostic Levels

### Normal

Record:

- final routing decision;
- application identity summary when available;
- selected policy;
- selected Driver;
- security-relevant failures.

### Detailed

Additionally record:

- Match Set;
- rejected rule reasons;
- identity evidence/confidence;
- capability candidates;
- scheduler decision;
- DNS/routing correlation.

### Diagnostic

Additionally allow bounded per-flow tracing:

- identity resolution steps;
- matcher evaluation;
- policy calculation;
- Intent construction;
- Driver handoff;
- runtime result.

Diagnostic mode must have:

- explicit user control;
- bounded retention;
- sampling/rate limits;
- sensitive-data redaction;
- exportable evidence;
- clear start/stop state.

## 6. Privacy and Security

Application identity and routing logs can reveal sensitive usage patterns.

Therefore:

- logs are local by default;
- credentials, tokens and private keys are never logged;
- raw payloads are not logged by the routing diagnostic layer;
- destination data may be redacted or hashed according to the configured privacy level;
- PID and ephemeral identifiers must expire with their useful lifetime;
- retention is bounded;
- diagnostic export is explicit;
- user-disabled logging must not be silently re-enabled.

Detailed diagnostics must never bypass the platform security boundary.

## 7. Cross-platform Mapping

The canonical model is platform-neutral, but evidence comes from native mechanisms.

| Platform | Typical identity evidence | Primary boundary |
|---|---|---|
| Android | package, UID, process/socket owner, VPN context | VpnService / OS APIs |
| iOS | app identity available through Network Extension boundaries | Network Extension |
| Windows | executable, process, user/session, system networking APIs | native networking/WFP/TUN integration |
| macOS | process/executable/user identity where permitted | Network Extension/native APIs |
| Linux | PID, executable, UID, cgroup/socket ownership where available | TUN/netfilter/cgroup/native APIs |

The table describes evidence classes, not guaranteed availability.

A platform must expose unsupported states rather than inventing equivalent data.

## 8. Kernel Boundary

Mihomo, sing-box and Xray may consume application/process information when their native execution path supports it, but AngelaNexus owns the canonical identity and policy semantics.

The platform may:

1. resolve identity itself;
2. calculate policy;
3. produce an Intent;
4. provide only the execution information required by the selected Driver.

A Driver must not silently replace a confirmed platform decision with a different global policy.

## 9. Failure and Recovery

Identity resolution failure must be explicit:

Resolve
  ↓
Confirmed?
 ├─ yes → Match
 ├─ unknown → Apply configured unknown-identity policy
 ├─ unsupported → report capability boundary
 ├─ conflict → conflict handling
 └─ failed → bounded retry / preserve evidence

A retry must be bounded and must not turn every connection into a background polling loop.

## 10. User Experience

The user should be able to inspect:

- which APP/process produced the flow;
- what identity evidence was available;
- which rule(s) matched;
- which rules did not match and why;
- which policy was selected;
- which Intent was generated;
- which Driver executed it;
- whether execution succeeded;
- what prevented a desired rule from matching.

The UI should provide a direct path:

Request
  → Why this route?
  → Identity
  → Matched rules
  → Policy
  → Intent
  → Driver
  → Result

This is more useful than exposing raw kernel logs alone.

## 11. Verification Requirements

Before application-aware routing is considered implemented, tests must cover:

- exact package match;
- process match;
- package + domain combination;
- package + network type combination;
- multiple matching rules;
- conflicting rules;
- unknown application identity;
- unsupported platform lookup;
- shared UID;
- stale PID;
- external/non-local traffic;
- process lookup failure;
- no-process-rule optimization;
- diagnostic log redaction;
- bounded diagnostic retention;
- Driver selection after policy calculation;
- all three execution Drivers receiving the same canonical Intent semantics.

A platform-specific implementation is not complete until the canonical decision can be explained from identity evidence through final execution result.

## 12. Community-derived design conclusions

Recent upstream/community issue reports expose recurring failure modes around package/process routing:

- package matching can disappear or behave differently across Android builds;
- shared UIDs can cause package ambiguity;
- some socket/interface paths prevent process-owner resolution;
- some traffic has no local process identity;
- unconditional process lookup can create repeated log noise;
- users need process/application information in request views to understand which app generated a connection.

AngelaNexus therefore treats **identity evidence, explicit unknown states, bounded lookup, explainable decisions, and diagnostic correlation as architectural requirements**, not optional UI enhancements.

## Final rule

> **精准分流不是“尽可能猜出 APP”，而是“在证据允许的范围内精确匹配，并把证据、限制和最终决策完整解释出来”。**
