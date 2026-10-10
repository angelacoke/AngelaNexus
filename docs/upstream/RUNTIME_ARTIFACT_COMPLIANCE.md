# Runtime Artifact Compliance

AngelaNexus treats a runtime artifact as a separately verifiable release input.

The artifact record binds:
- kernel and exact upstream version/commit;
- target platform and ABI;
- SHA-256 digest;
- authoritative source location;
- declared license;
- linkage model: embedded, IPC, or process;
- source availability;
- provenance verification;
- license/distribution review;
- final verification state.

A native runtime is not release-ready merely because a native factory exists. Native activation must have a verified artifact record and must fail closed when verification, provenance, source availability, or license review is incomplete.

## Android enforcement

The Android release jobs call `scripts/verify_android_runtime_release_gate.py` before any job with signing secrets can start. The checker requires the requested runtime manifest to declare `distributionStatus: approved`, `policy.failClosed: true`, and explicit `approved` statuses for license review, provenance review, and naming compliance. Missing, malformed, or incomplete manifests fail closed. This script enforces recorded decisions; it does not make legal determinations or grant approval.

The default signed Android package requires approved Xray and sing-box manifests. The optional Mihomo-enabled package requires approved Xray, sing-box, and Mihomo manifests. Both package paths are manual-dispatch-only on `main` and require the repository's release-approval variable. The separate Xray and Mihomo native validation workflows build into runner-local temporary storage and do not upload or hand off native binaries. The Mihomo package workflow rebuilds from its pinned source in the same runner only after its gate passes; it does not download a reusable `.so` from another workflow. No release workflow has been run as part of this change.

The production sing-box pin remains v1.14.2. A newer version is not adopted merely because upstream has published it; compatibility, license/naming, and provenance review must remain separate and documented. The current Xray record remains blocked until the actual generated AAR's source, resolved dependencies, compatibility, licensing, and provenance are verifiable.

## Historical artifact cleanup (2026-10-10)

A legacy `singbox-android-native-build.yml` workflow on the non-default branch `android/singbox-native-runtime-build` had uploaded the `singbox-native-runtime` Actions artifact after builds pinned to `v1.14.0-beta.4`. That workflow is absent from `main` and PR #114; GitHub reports no open PR or active run for the branch. A full paginated inventory found two still-retained artifacts, IDs `11300290199` and `11299313303`, each 207,104,138 bytes, from completed runs `37192284533` and `37192281569`. Both exact artifacts were deleted and verified absent from the run listings and the subsequent full inventory.

The legacy branch workflow was then updated in commit `de851844c7e602e5567781feaba9870d3bf70891` to keep AARs, provenance, and API inspection runner-local instead of uploading them. This cleanup does not promote the beta runtime or approve distribution; the production v1.14.2 distribution status remains blocked.

This record is an engineering/compliance control and is not legal advice.
