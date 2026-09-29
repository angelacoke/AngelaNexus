# AngelaNexus native platform layer

This directory contains real OS-facing transport boundaries. It is separate from
the platform-neutral JavaScript core.

## Native boundaries

- Android: VPN service and TUN lifecycle.
- iOS/macOS: Network Extension packet-tunnel lifecycle.
- Windows: dynamic Wintun DLL loading boundary.
- Linux: /dev/net/tun creation boundary.

## Scope

These files do not claim complete production VPN integration. They establish the
native OS boundary without silently selecting routing, DNS, kernel, node, chain,
or security policy.

The next integration layer must connect these boundaries to the selected
Mihomo, sing-box, or Xray adapter and verify them on each target OS.

## Security rule

No native implementation may silently fall back to direct networking when the
selected proxy runtime fails. Fail-closed behavior belongs to the application
security/policy layer and must remain explicit and testable.
