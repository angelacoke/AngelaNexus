# sing-box v1.14.3 Compatibility Review

## Review status

- **Review date:** 2026-10-10
- **Decision:** Do not change the production pin; keep **v1.14.2**.
- **Status:** Source comparison complete; build, app-regression, and device-traffic verification pending.

## Verified upstream baseline

The official [v1.14.3 release](https://github.com/SagerNet/sing-box/releases/tag/v1.14.3) was published on 2026-10-09, is marked non-prerelease by the GitHub Releases API, and resolves to commit `7054cac5124465ffdb145870d7c01885566711b1`. The official comparison [v1.14.2...v1.14.3](https://github.com/SagerNet/sing-box/compare/v1.14.2...v1.14.3) contains **30 commits**, not just a tag bump. The release notes say only “Fixes and improvements,” so no narrower security or compatibility claim is inferred.

Both inspected tags declare Go `1.25.5` and SagerNet gomobile `v0.1.12`. The v1.14.3 LICENSE remains GPL-3.0-or-later and includes the additional condition that derivative works may not use the product name or imply association without prior consent. This does not clear the existing distribution gate.

## Material Android/libbox changes in the comparison

- `experimental/libbox/command_server.go` changes `Pause`/`Wake` behavior. In v1.14.3, `Pause` records a device-sleep event, is limited to Android/iOS (excluding tvOS), closes idle connections and then invokes `DevicePause`; `Wake` records device wake and only wakes Android. v1.14.2 uses platform sleep/wake records, pauses through a different path, and contains an iOS timer-based wake. These changes are relevant to lifecycle/TUN regression testing.
- `experimental/libbox/setup.go` adds a `PlatformMetadata` field to `SetupOptions`. This appears additive in the source diff, but the generated Android binding and exact Kotlin API still need to be built and checked.
- `experimental/libbox/power_report.go` changes the exported helper from `PromotePowerReportDraft` to `DiscardPowerReportDraft`. Any generated binding/API assumptions must be checked against the app's actual use.
- The dependency lockfile changes as well; for example, the inspected diff updates several SagerNet modules. The full dependency/SBOM and exact generated AAR provenance remain unreviewed.

The current AngelaNexus `SingBoxAndroidKernelDriver` calls setup, start/reload, close-service, and close; it does not directly call the exported `Pause` or `Wake` methods. That narrows the direct Kotlin call-site risk but does **not** establish compatibility of the updated libbox runtime or its lifecycle behavior.

## Promotion criteria

Keep the production ref and commit at v1.14.2 (`af6e64c3b69e6132ebaee0e1a3d24e93903f6709`) until all of the following are complete for candidate v1.14.3:

1. Build the Android AAR from the exact candidate commit in an isolated candidate branch, record its hash and dependency provenance, and compile the app against the generated API.
2. Pass Android unit and connected-emulator tests, including TUN attach/start/stop, network changes, service restart, and sleep/resume behavior.
3. Validate actual TUN traffic, reconnect behavior, and privacy/no-leak behavior on a physical Android device.
4. Complete the same license, naming, notices, SBOM, and distribution approval required by the runtime compliance manifest.

No production pin was changed, no release artifact was created, and no merge was performed as part of this review.
