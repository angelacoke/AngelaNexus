import assert from "node:assert/strict";
import test from "node:test";
import {
  TransparentBackendIds,
  getTransparentBackendCapability,
  listTransparentBackends,
  missingTransparentBackendCapabilities,
  selectTransparentBackend,
} from "./transparent-backend-capability.js";

test("matrix contains platform-specific capture boundaries", () => {
  const ids = listTransparentBackends().map((item) => item.id);
  assert.ok(ids.includes(TransparentBackendIds.ANDROID_VPN));
  assert.ok(ids.includes(TransparentBackendIds.LINUX_EBPF_SOCKET));
  assert.ok(ids.includes(TransparentBackendIds.MACOS_NETWORK_EXTENSION));
  assert.ok(ids.includes(TransparentBackendIds.WINDOWS_WFP));
  assert.ok(ids.includes(TransparentBackendIds.IOS_PACKET_TUNNEL));
});

test("linux socket capture exposes attribution only as a declared capability", () => {
  const backend = getTransparentBackendCapability(TransparentBackendIds.LINUX_EBPF_SOCKET);
  assert.ok(backend.capabilities.includes("socket-capture"));
  assert.ok(backend.capabilities.includes("process-identity"));
  assert.equal(backend.evidence, "runtime-probe");
});

test("android root does not require process identity", () => {
  const missing = missingTransparentBackendCapabilities(
    TransparentBackendIds.ANDROID_ROOT,
    ["tcp", "udp", "dns-interception", "ipv4", "ipv6", "uid-identity", "policy-routing", "atomic-rollback"],
  );
  assert.deepEqual(missing, []);
  assert.deepEqual(
    missingTransparentBackendCapabilities(TransparentBackendIds.ANDROID_ROOT, ["process-identity"]),
    ["process-identity"],
  );
});

test("unverified capability-gated backend cannot be selected", () => {
  const result = selectTransparentBackend({
    platform: "windows",
    requiredCapabilities: ["socket-capture", "process-identity"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no-verified-backend");
});

test("verified capability-gated backend can be selected", () => {
  const result = selectTransparentBackend({
    platform: "linux",
    requiredCapabilities: ["socket-capture", "process-identity", "original-destination"],
    evidence: { [TransparentBackendIds.LINUX_EBPF_SOCKET]: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.backend.id, TransparentBackendIds.LINUX_EBPF_SOCKET);
});
