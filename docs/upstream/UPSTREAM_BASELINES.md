# AngelaNexus Upstream Kernel Baselines

This document records the upstream release-channel baseline used by AngelaNexus. It is a provenance record, not an authorization to automatically activate or merge a kernel update.

Verification date: 2026-09-29 UTC

| Kernel | Repository | Stable baseline | Preview baseline | Channel verification |
|---|---|---:|---:|---|
| Mihomo | MetaCubeX/mihomo | 1.19.31 | Prerelease-Alpha | GitHub Releases API |
| sing-box | SagerNet/sing-box | 1.14.2 | 1.15.0-alpha.9 | GitHub Releases API |
| Xray-core | XTLS/Xray-core | 26.3.27 | 26.9.9 | GitHub Releases API |

## Channel rules

- Stable means the newest published release whose GitHub prerelease flag is false and whose draft flag is false.
- Preview means the newest published release whose GitHub prerelease flag is true and whose draft flag is false.
- Preview releases must never be silently substituted for the stable baseline.
- A stable-baseline change requires upstream comparison, adapter-impact review, unit tests, compatibility tests, runtime kernel conformance, security review, and explicit user approval.
- Automatic runtime activation and automatic merge remain disabled.

## Independently verified release metadata

- Mihomo v1.19.31: stable release, published 2026-09-14.
- sing-box v1.15.0-alpha.9: prerelease, published 2026-09-26.
- Xray-core v26.3.27: stable release, published 2026-03-27.
- Xray-core v26.9.9: prerelease, published 2026-09-08.

## Provenance sources

- https://github.com/MetaCubeX/mihomo/releases
- https://github.com/SagerNet/sing-box/releases
- https://github.com/XTLS/Xray-core/releases
- GitHub Releases API for each repository was used to distinguish stable and prerelease channels.

## Maintenance

The upstream checker uses explicit GitHub release-channel classification rather than relying on the generic releases/latest endpoint. This prevents a preview release from being treated as the stable baseline and records the preview channel separately for review.

This file must be updated whenever a verified baseline is promoted or the release-channel policy changes.
