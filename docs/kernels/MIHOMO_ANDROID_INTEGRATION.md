# Android Native Runtime Integration Baseline

Status: verified integration baseline; native runtime is not yet advertised as production-ready.

## Verified runtime baseline

- Current verified runtime release: v1.19.31
- Release commit: ab405ba
- Release date: 2026-09-14
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

The Kotlin layer currently exposes a backend-neutral native-host contract and delegation wrapper. These classes are not proof of a working native core.

The next implementation stage is the first real native bridge:

1. pin the runtime source at a verified revision;
2. add an independently authored Android/cgo bridge;
3. build libclash.so for supported Android ABIs;
4. add the minimal C/C++ JNI shim and Kotlin loader;
5. wire Android VpnService protection and TUN FD ownership;
6. add bridge ABI/version checks and artifact hashes;
7. run an Android smoke test proving load -> initialize -> TUN start -> stop;
8. only then mark Android native capability as available.

Configuration parsing and kernel selection remain in AngelaNexus Core; the Android native bridge must not duplicate that logic.