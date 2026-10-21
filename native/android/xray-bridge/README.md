# Pinned Xray mux shutdown adapter

This directory contains a reviewed patch and host regressions for the **same libXray `RunXray` / `StopXray` API used by the Android runtime**. It is not another kernel implementation.

## Fixed sources

- libXray: `3c694b23290f9849fe52284a345ebd4343bc90cd`
- Xray-core: `b26a91de4f3294e26a0ad0a970b81a386a41f789`, module `v1.260327.1-0.20260930074004-b26a91de4f32`
- Effective Go toolchain: `go1.27.1`, as already required by the pinned libXray module.

`source-lock.json` binds the pristine input files, reviewed patch, adapted outputs and injected tests to SHA-256 digests. The preparation script rejects unknown or dirty inputs and hash mismatches. Both Android AAR build entry points must use the prepared sibling `Xray-core` checkout with the upstream builder's `android local` mode; the default builder mode would remove the local replacement.

## Ownership and minimal fixes

`Manager.Select` now holds the existing manager read lock before loading the cache pointer. Cache replacement by AddHandler/RemoveHandler is consequently synchronized with cache reads. The pinned upstream `TestTagsCache` also uses atomic stop flags; its concurrent workload and assertions are retained, and the entire relevant upstream race suite still runs.

The outbound handler owns its TCP mux and XUDP managers. A manager delegates closing to its incremental picker. The picker makes close terminal, serializes cleanup-task start against close, signals all owned workers, and joins them before relinquishing ownership. Cleanup likewise joins signaled workers instead of forgetting them.

A mux worker owns its monitor, output reader, admitted input tasks and factory-created outbound `Process`. Closing first rejects further admission, cancels its context and interrupts the pipes, then waits for registered tasks to exit. Internal worker tasks only signal shutdown; they do not call the joining close method and wait on themselves. Client session IO is initialized before it becomes visible to concurrent lookup/close.

The VLESS task boundary also owns its two request/response tasks: error or cancellation interrupts their IO and joins both before `Process` returns. This is local to VLESS, not a rewrite of the shared task runner.

## Regressions

The host gate runs the complete relevant upstream mux, outbound manager, reverse compatibility and VLESS outbound race tests, as well as the libXray lifecycle package. The real-connection test dials a loopback VLESS mux TCP peer, observes initial bytes, then requires successful `StopXray`, a false running state, real peer EOF (not a read timeout), owned-worker exit, idempotent stop and a fresh second generation.

The negative gate restores only the two mux implementation files to their pinned old behavior in a disposable source pair. It keeps the cache race/test fixes and the other reviewed changes. Each of three independent negative executions must fail specifically because the admitted TCP mux transport remains open. A build failure, race report or unrelated timeout must not count as a successful negative control.

## Limits

These are Linux host Go tests of the native lifecycle API, not Android JNI, VPN/TUN, descriptor-handoff or physical-device tests. An AAR build or an application-launch emulator smoke is not evidence that the Android device stopped every kernel worker. Local environments without Gradle, adb and an Android SDK cannot perform those device checks.

This patch does **not** claim complete kernel shutdown. In particular, reverse Portal's custom picker has a separate pre-existing close-ownership gap; reverse compatibility compilation/race tests do not establish that its workers are drained. Other independent kernel subsystems are outside this adapter's bounded ownership claim. No merge or release is implied by these checks.
