# AngelaNexus Third-Party License Inventory

This file records third-party components positively identified in the repository and in the Android build path. It is an inventory, not legal advice and not a substitute for each component's license text or for a complete SBOM.

## Directly identified dependencies

| Component | Current evidence | License status | Notes |
|---|---|---|---|
| js-yaml | root `package.json` | MIT | Used by the JavaScript core dependency set. Exact transitive inventory must be regenerated from the lockfile when a lockfile is added. |
| AndroidX Activity Compose | `native/android/app/build.gradle.kts` | Apache-2.0 family | Android dependency. Exact resolved version is declared by the repository build file. |
| AndroidX Compose UI / Material / Material3 | `native/android/app/build.gradle.kts` and Compose BOM | Apache-2.0 family | Exact resolved versions are governed by the Compose BOM where applicable. |

## Android runtime kernels

| Runtime | Exact source evidence | Declared license | Linkage and distribution state |
|---|---|---|---|
| sing-box | [SagerNet/sing-box v1.14.2](https://github.com/SagerNet/sing-box/tree/v1.14.2), commit `af6e64c3b69e6132ebaee0e1a3d24e93903f6709` | GPL-3.0-or-later; the pinned LICENSE also restricts derivative works from using the product name or implying association without prior consent | `libbox.aar` and `libbox-legacy.aar` are embedded in the Android app. Distribution is **blocked** pending exact-artifact license, naming, notice, source, SBOM and provenance review. Production pin remains v1.14.2; v1.14.3 is not adopted and requires a separate compatibility review. |
| Xray via libXray | [XTLS/libXray](https://github.com/XTLS/libXray), commit `3c694b23290f9849fe52284a345ebd4343bc90cd`; its committed `go.mod` declares Xray-core pseudo-version `v1.260327.1-0.20260930074004-b26a91de4f32`, resolving to commit `b26a91de4f3294e26a0ad0a970b81a386a41f789` / Xray-core v26.9.30 | MIT for libXray plus MPL-2.0 for the declared Xray-core dependency; complete transitive notices remain unverified | `libXray.aar` is embedded. The pinned upstream Android builder deletes/recreates `go.mod`/`go.sum`, runs unbounded dependency operations and downloads geodata from mutable `latest` URLs. The actual generated dependency/data set is therefore not proven by the wrapper pin. Distribution is **blocked**; do not change the Xray pin until source, resolved dependencies, compatibility, licensing and provenance are verified. |
| Mihomo | [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo), commit `88dcbf7f1614a67c3b36b848ee3592dfa92ada36` | GPL-3.0 | Optional `libclash.so` native runtime. Distribution remains **blocked** by `MIHOMO_ANDROID_RUNTIME_COMPLIANCE.json`; no native build artifact is uploaded by CI. |

The production sing-box pin is intentionally kept at the already adopted stable v1.14.2 baseline. The official v1.14.3 release is not silently promoted; it remains a candidate for a separate compatibility review. Xray-core v26.9.30 and v26.10.10 are marked pre-release by the upstream Releases API; no promotion to those versions is authorized.
The source-level v1.14.3 review is recorded in [SINGBOX_V1.14.3_COMPATIBILITY_REVIEW.md](../upstream/SINGBOX_V1.14.3_COMPATIBILITY_REVIEW.md); AAR build, app regression, and device traffic validation remain pending.

## Release requirement and limitations

Android release workflows must fail closed unless every embedded runtime's exact compliance manifest explicitly approves distribution, licensing, provenance and naming. Debug builds and CI validation may build source in a private runner, but they must not publish reusable runtime binaries. A release-grade SBOM, complete third-party notice set, source-offer information, exact artifact hashes, reproducible provenance and compatibility review are required before any distribution status can be approved. This inventory intentionally does not claim to be the complete transitive dependency set.

## Verification sources

- [AngelaNexus license policy](LICENSE_POLICY.md)
- [Runtime artifact compliance requirements](../upstream/RUNTIME_ARTIFACT_COMPLIANCE.md)
- [Kernel runtime licensing and linkage compliance](../upstream/KERNEL_RUNTIME_LICENSING_AND_LINKAGE.md)
- [sing-box v1.14.2 LICENSE](https://github.com/SagerNet/sing-box/blob/v1.14.2/LICENSE)
- [libXray current pinned LICENSE](https://github.com/XTLS/libXray/blob/3c694b23290f9849fe52284a345ebd4343bc90cd/LICENSE)
- [Xray-core v26.3.27 LICENSE](https://github.com/XTLS/Xray-core/blob/v26.3.27/LICENSE)
