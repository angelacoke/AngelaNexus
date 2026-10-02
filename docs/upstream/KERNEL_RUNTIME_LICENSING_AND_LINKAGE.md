# Kernel Runtime Licensing and Linkage Compliance

AngelaNexus currently declares Apache-2.0. Native embedding of a copyleft kernel is therefore a mandatory compliance boundary.

## Verified upstream facts

- Mihomo is GPL-3.0.
- sing-box is GPL-3.0-or-later.
- Xray-core is MPL-2.0.
- sing-box Android uses its libbox platform interface to integrate Android VpnService/TUN.

## Runtime rule

A GPL kernel must not be silently treated as an Apache-2.0-compatible embedded dependency.

AngelaNexus distinguishes:

1. Process runtime: the kernel executes as a separate process. Distribution, notices and dependency licenses still require audit.
2. Embedded/native runtime: kernel code is linked into the application process. Exact license and dependency compatibility must be reviewed before release.
3. External runtime package: a separately licensed runtime may be used through an explicit IPC boundary when the distribution model has been reviewed.

## Required evidence before native release

- exact upstream version and commit;
- artifact SHA-256;
- complete license/notice inventory;
- source availability;
- build provenance;
- linkage model;
- distribution model;
- compatibility review against the selected AngelaNexus distribution license.

## sing-box Android finding

Official sing-box v1.14.2 provides experimental/libbox for Android embedding. The Android platform interface opens the Android VpnService TUN and supplies the descriptor to sing-box.

Therefore AngelaNexus must not fake native sing-box capability or claim command-line execution is equivalent to the Android native TUN integration.

Native sing-box remains gated until its distribution/linkage model is compliant and its artifact is reproducibly verified.

## Fail-closed

If a required native artifact is missing, unverifiable, provenance-incomplete, or license-incompatible:

- native selection fails;
- automatic fallback must not silently change execution semantics;
- the unsupported state must remain visible;
- the previous verified runtime remains available for recovery.

This is a compliance and architecture record, not legal advice.