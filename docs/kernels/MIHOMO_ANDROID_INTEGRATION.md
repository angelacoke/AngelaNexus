# Android Native Runtime Integration Baseline

Status: verified Android native-runtime packaging baseline; physical-device runtime evidence is still required.

## Verified runtime baseline

- Current verified runtime release: v1.19.32
- Release commit: 88dcbf7f1614a67c3b36b848ee3592dfa92ada36
- Release revision pinned by CI: 88dcbf7f1614a67c3b36b848ee3592dfa92ada36
- Android arm64-v8a artifact: mihomo-android-arm64-v8-v1.19.31.gz
  SHA-256: de00bc53ed15163636b48ea7b9e305f14c39248d6bffd9cd04466fee94492f99
- Android armv7 artifact: mihomo-android-armv7-v1.19.31.gz
  SHA-256: c2658644e44a61136bca28ae8accf0922065c143b57f8c8fc07bbd31997ca5e00
- Android amd64 artifact: mihomo-android-amd64-v1.19.31.gz
  SHA-256: 6f6ebcb3646d3ece36b48ea7b9e305f14c39248d6bffd9cd04466fee94492f99

These are compressed Android executable artifacts, not hashes for a c-shared JNI library. They must not be substituted for native .so integrity values.

## Integration boundary

AngelaNexus uses an independently authored Android native boundary. The application layer owns lifecycle, configuration transport, VPN/TUN ownership, security policy, ABI validation and runtime status. The native runtime owns packet processing and native networking operations.

The Android integration must remain a strict boundary:

1. no configuration parsing duplication in the native bridge;
2. no kernel-selection logic in the Android bridge;
3. no implicit runtime fallback;
4. no unverified native artifact may be loaded;
5. no native capability may be advertised before an actual smoke test succeeds.

## Integrity and release requirements

The release pipeline must record:

1. exact runtime revision;
2. exact bridge source revision;
3. Go/NDK/toolchain versions;
4. native ABI list;
5. SHA-256 for every shipped native artifact;
6. complete release-time license and notice inventory.

No prebuilt external AAR or native library is accepted as an implicit production dependency.

## Current implementation state

The first real native bridge is now implemented and build-verified:

1. runtime source is pinned to the verified v1.19.32 revision;
2. the independently authored Android/cgo bridge exports initialization, configuration, TUN lifecycle and runtime-control functions;
3. `libclash.so` is built for arm64-v8a, armeabi-v7a and x86_64;
4. the C/C++ JNI shim and Kotlin loader are present;
5. Android VpnService remains the owner of the TUN descriptor and lifecycle boundary;
6. native artifact hashes are pinned and verified during packaging;
7. signed Mihomo-enabled APK/AAB artifacts are produced by CI.

The remaining evidence gate is a reproducible Android physical-device smoke test proving load -> initialize -> configuration apply -> TUN start -> traffic -> stop. Until that evidence exists, the runtime is not marked end-to-end production-ready.

Configuration parsing and kernel selection remain in AngelaNexus Core; the Android native bridge must not duplicate that logic.