# AngelaNexus Third-Party License Inventory

This file records third-party components that have been positively identified from the current repository manifests. It is an inventory, not a replacement for each component's own license text.

## Directly identified dependencies

| Component | Current evidence | License status | Notes |
|---|---|---|---|
| js-yaml | root package.json | MIT | Used by the JavaScript core dependency set. Exact transitive dependency inventory must be regenerated from the lockfile when a lockfile is added. |
| AndroidX Activity Compose | native/android/app/build.gradle.kts | Apache-2.0 family | Android dependency. Exact resolved version is declared by the repository build file. |
| AndroidX Compose UI | native/android/app/build.gradle.kts | Apache-2.0 family | Android dependency. Exact resolved version is declared through the Compose BOM. |
| AndroidX Compose Material / Material3 | native/android/app/build.gradle.kts | Apache-2.0 family | Android dependency. Exact resolved versions are governed by the Compose BOM where applicable. |
| AndroidX Compose BOM | native/android/app/build.gradle.kts | Apache-2.0 family | Dependency platform. |

## Runtime kernels

Mihomo, sing-box, and Xray are architectural targets described by the project documentation. At the time of this inventory, the repository does not contain a verified embedded production runtime for those kernels. Their licenses must therefore be recorded when source, binaries, or other redistributable artifacts are actually introduced.

## Important limitation

This inventory is intentionally conservative. It does not claim that the entries above are the complete transitive dependency set. A release-grade Software Bill of Materials (SBOM) and machine-generated license report must be produced from the resolved dependency graph before release.

## Verification sources

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- js-yaml project license metadata: https://github.com/nodeca/js-yaml
- AndroidX licensing information: https://developer.android.com/jetpack/androidx
