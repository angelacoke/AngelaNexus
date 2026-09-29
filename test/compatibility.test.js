import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { KernelCapabilityManifest } from "../src/core/kernel-capability-manifest.js";
import { CompatibilityStatus, KernelVersions, protocolCompatibility, validateUnifiedCompatibility, buildCompatibilityMatrix } from "../src/core/compatibility.js";

test("recognizes documented common protocols", () => {
  assert.equal(protocolCompatibility(Kernels.MIHOMO, "ss").status, CompatibilityStatus.SUPPORTED);
  assert.equal(protocolCompatibility(Kernels.SING_BOX, "vless").status, CompatibilityStatus.SUPPORTED);
  assert.equal(protocolCompatibility(Kernels.XRAY, "vmess").status, CompatibilityStatus.SUPPORTED);
});

test("tracks stable kernel baselines", () => {
  assert.equal(KernelVersions[Kernels.MIHOMO].stable, "1.19.31");
  assert.equal(KernelVersions[Kernels.SING_BOX].stable, "1.14.1");
  assert.equal(KernelVersions[Kernels.XRAY].stable, "26.3.27");
});

test("keeps protocol claims in a dedicated manifest", () => {
  for (const kernel of Object.values(Kernels)) {
    assert.ok(Array.isArray(KernelCapabilityManifest[kernel].protocols));
    assert.ok(Array.isArray(KernelCapabilityManifest[kernel].unsupported));
  }
  assert.ok(KernelCapabilityManifest[Kernels.XRAY].unsupported.includes("hysteria2"));
});

test("does not claim Xray supports Hysteria2, TUIC or AnyTLS", () => {
  assert.equal(protocolCompatibility(Kernels.XRAY, "hysteria2").status, CompatibilityStatus.UNSUPPORTED);
  assert.equal(protocolCompatibility(Kernels.XRAY, "tuic").status, CompatibilityStatus.UNSUPPORTED);
  assert.equal(protocolCompatibility(Kernels.XRAY, "anytls").status, CompatibilityStatus.UNSUPPORTED);
});

test("recognizes Xray Hysteria and WireGuard", () => {
  assert.equal(protocolCompatibility(Kernels.XRAY, "hysteria").status, CompatibilityStatus.SUPPORTED);
  assert.equal(protocolCompatibility(Kernels.XRAY, "wireguard").status, CompatibilityStatus.SUPPORTED);
});

test("validates every unified node before compilation", () => {
  const result = validateUnifiedCompatibility({ kernel: Kernels.XRAY, nodes: [{ id: "v1", protocol: "vless" }, { id: "h2", protocol: "hysteria2" }] });
  assert.equal(result.ok, false);
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0].id, "h2");
});

test("builds a user-visible cross-kernel capability matrix", () => {
  const matrix = buildCompatibilityMatrix(["vless", "hysteria", "hysteria2", "tuic", "anytls", "wireguard"]);
  const h2 = matrix.find(row => row.protocol === "hysteria2");
  const xh = matrix.find(row => row.protocol === "hysteria");
  const wg = matrix.find(row => row.protocol === "wireguard");
  assert.equal(h2["sing-box"].status, CompatibilityStatus.SUPPORTED);
  assert.equal(h2.xray.status, CompatibilityStatus.UNSUPPORTED);
  assert.equal(xh.xray.status, CompatibilityStatus.SUPPORTED);
  assert.equal(wg["sing-box"].status, CompatibilityStatus.UNSUPPORTED);
  assert.equal(wg.xray.status, CompatibilityStatus.SUPPORTED);
});