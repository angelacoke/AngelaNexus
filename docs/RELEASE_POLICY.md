# AngelaNexus Release Policy

## 1. Release principle

AngelaNexus APP will not begin with a Stable / formal release. Early public distribution is explicitly pre-release and must be labeled accordingly.

A successful build, signed APK/AAB, or green CI run does not by itself establish production readiness.

## 2. Release lifecycle

```text
Development
    ↓
Alpha / Experimental
    ↓
Preview
    ↓
Beta
    ↓
Release Candidate
    ↓
Stable
```

A build may remain in a channel for as long as required by evidence. The project must not advance a build merely to meet a schedule.

## 3. Current application status

The Android application currently uses version `0.1.0` and is explicitly a pre-release/development baseline. It must not be presented as Stable.

## 4. Channel requirements

### Alpha / Experimental

Purpose: validate architecture, core workflows, integration boundaries, and early real-device behavior.

Requirements:

- clear pre-release labeling
- known limitations documented
- no Stable/production-ready claim
- automated build and test gates where applicable
- safe failure behavior for unsupported capabilities

### Preview

Purpose: validate broader user workflows and platform integration.

Requirements:

- Alpha regressions addressed or explicitly documented
- core import/configuration workflows verified
- capability detection and Driver scheduling verified
- basic security and leak-prevention checks passed for supported scenarios
- resource behavior measured on representative devices

### Beta

Purpose: validate release-candidate-level product behavior with broader compatibility coverage.

Requirements:

- major regression suite passing
- supported-device testing expanded
- three-kernel capability/conformance verification passing for claimed features
- network lifecycle and failure handling verified
- RAM, CPU, wakeup, and battery measurements available
- upgrade/configuration migration behavior verified
- known limitations documented

### Release Candidate

Purpose: verify that a specific build is a candidate for Stable release.

Requirements:

- no known release-blocking defects
- release artifact and signing verification passed
- security and leak-prevention verification passed for the supported scope
- resource regressions reviewed and accepted only with explicit evidence
- real-device verification completed for the claimed release scope
- release notes and known limitations finalized
- rollback/recovery path verified where applicable

### Stable

Stable is a separate engineering state, not merely a version-number change.

Stable may only be declared after the project has sufficient evidence that the claimed release scope is reliable, secure, resource-efficient, maintainable, and reproducible.

## 5. Release gates

Every release candidate must be evaluated against:

- functionality
- regression stability
- security
- leak prevention
- protocol/transport conformance
- Driver capability matching
- real-device behavior
- cross-platform scope
- memory usage
- CPU usage
- background wakeups
- battery consumption
- network control overhead
- signing and artifact integrity
- upgrade and migration behavior
- known limitations

An unexplained or unacceptable regression in a release-critical area blocks advancement.

## 6. Version semantics

Version numbers must not imply Stable status by themselves.

Pre-release status must be visible through the release channel, release notes, and application-facing distribution metadata where supported.

## 7. Verification rule

Before changing a release channel, the previous channel's required gates must be re-checked. Failed or stalled verification must be investigated and resolved before advancement.

The release process follows the same constitutional rule as implementation:

```text
Verify
  ↓
Audit
  ↓
Fix
  ↓
Re-verify
  ↓
Advance
```

## 8. User-facing honesty

AngelaNexus must clearly distinguish:

- development build
- Alpha / Experimental
- Preview
- Beta
- Release Candidate
- Stable

The project must not use Stable, production-ready, final, or equivalent language for a pre-release build.
