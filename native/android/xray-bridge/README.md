# Pinned Xray bounded shutdown adapter

This directory contains a reviewed patch and host regressions for the **same libXray `RunXray` / `StopXray` API used by the Android runtime**. It is not another kernel implementation.

## Fixed sources

- libXray: `3c694b23290f9849fe52284a345ebd4343bc90cd`
- Xray-core: `b26a91de4f3294e26a0ad0a970b81a386a41f789`, module `v1.260327.1-0.20260930074004-b26a91de4f32`
- Effective Go toolchain: `go1.27.1`, as already required by the pinned libXray module.

`source-lock.json` binds pristine inputs, the reviewed patch, adapted outputs and injected tests to SHA-256 digests. Preparation rejects unknown/dirty inputs and hash mismatches. Both Android AAR entry points use the prepared sibling `Xray-core` with the upstream builder's `android local` mode; default builder mode would remove the local replacement.

## Previous fixes remain unchanged

`Manager.Select` holds the manager read lock before loading its cache pointer. Upstream `TestTagsCache` uses atomic stop flags without reducing its workload or assertions. Complete related upstream race suites still run.

The outbound handler owns its TCP mux and XUDP managers. Its incremental picker makes close terminal, cancels all workers and joins them. A mux worker owns its monitor, output reader, admitted input tasks and factory-created outbound `Process`; internal tasks signal shutdown rather than joining themselves. Session IO is initialized before concurrent publication. The VLESS outbound boundary interrupts and joins its request/response tasks before returning. The Portal extension does not change those implementations.

## Reachable Portal entry and ownership

The pinned JSON loader **rejects legacy top-level `reverse.portals`**. Directly injecting that removed feature into core would not demonstrate Android reachability. The supported entry is a VLESS inbound user with `reverse.tag`, authenticated by reverse command `0x04`. `proxy/vless/inbound` creates the same `StaticMuxPicker` and `PortalWorker`, without constructing the legacy `app/reverse.Portal`.

`XrayAndroidKernelDriver.applyConfiguration` passes serialized JSON to `XrayRuntimeService`. Its `injectTun` preserves existing inbounds while adding TUN/env entries. The service calls `libXray.LibXray.runXray`/`stopXray` through the Go mobile binding. A supplied supported inbound can therefore reach this native worker/stop boundary. The normal node compiler does not itself generate reverse server inbounds. This is a code-path and host API proof, **not** an on-device Android/JNI execution.

The static picker owns a cancellable, joined cleanup loop. Close is terminal, signals all workers before joining them, and closes rejected late workers. Each Portal worker owns one heartbeat/inactivity loop instead of detached callbacks. Close interrupts control pipes, closes the mux transport and joins the loop and mux tasks. Production retains the 2-second heartbeat and 24-hour inactivity policy. Draining is atomic and the control writer remains immutable during cancellation.

VLESS reverse registration/removal is serialized with inbound close. A missing default outbound causes a bounded handshake failure: the peer owns retry once configuration is ready, instead of an indefinitely sleeping registration loop. Failed registration closes the unpublished picker. Removal closes the exact local owner, then atomically compare-removes it through `Manager.RemoveHandlerIf`; a same-tag replacement cannot be deleted by an old owner. Failed removal retains that closed object for explicit RemoveUser/Close retry; GetReverse cannot reuse it. Reverse handler Close never calls the manager, which may hold its lock while closing handlers. The retained legacy Portal API also closes its picker on failed Start and tracks its exact registered handler for retry-safe removal; removed legacy JSON is not re-enabled.

## Regressions

The host gate runs the complete mux, outbound manager, reverse, VLESS inbound/outbound and libXray lifecycle packages with `-race -count=3`. Tests cover concurrent admission/close, rejected workers, cleanup joins, blocked heartbeat interruption, inactivity exit, duplicate registration, bounded missing-default retry, failed registration cleanup, removal failure retry, replacement protection and real manager/inbound concurrent Close.

The original real TCP VLESS mux regression remains. The new regression starts libXray with supported VLESS reverse JSON, authenticates a real loopback TCP peer, and requires control-frame bytes beyond the VLESS response header before StopXray. It requires clean peer EOF (not a deadline), no remaining owned mux workers, idempotent stop and a fresh second generation. Observations occur before closing the peer, which would hide a missing stop owner.

Two independent negative gates each run three times. One restores only the two pinned mux implementation files. The other retains the reviewed mux implementation and restores only `app/reverse/portal.go` and `proxy/vless/inbound/inbound.go`. The Portal negative must fail with both missing peer EOF and remaining Portal-owned mux workers. Build failures, race reports and unrelated timeouts cannot count as successful controls. CI uploads these logs alongside AAR provenance.

## Limits

These are Linux host Go tests of the native lifecycle API, not Android JNI, VPN/TUN, descriptor-handoff or physical-device tests. An AAR build or application-launch emulator smoke does not establish that an Android device stopped every kernel worker. Local environments without Gradle, adb and an Android SDK cannot perform those checks.

This patch does **not** claim complete kernel shutdown. Other independent subsystems, VLESS reverse bridge monitoring and arbitrary uninterruptible custom transports are outside this bounded Portal ownership claim. The pinned libXray wrapper still clears its instance pointer if an unrelated core feature Close returns an error; local reverse-removal retry tests do not prove whole-core error recovery. No merge or release is implied.
