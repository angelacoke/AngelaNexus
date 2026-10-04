import test from "node:test";
import assert from "node:assert/strict";
import {
  Kernels,
  createUnifiedKernelSelection,
  selectUnifiedKernel,
} from "./unified-kernel-selection.js";

const VLESS = {
  id: "node-1",
  name: "Node 1",
  protocol: "vless",
  server: "example.com",
  port: 443,
  uuid: "00000000-0000-4000-8000-000000000001",
  tls: true,
  network: "ws",
  path: "/",
};

test("selects a registered kernel deterministically", () => {
  const result = createUnifiedKernelSelection(VLESS);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready");
  assert.equal(result.selected.kernel, Kernels.MIHOMO);
  assert.deepEqual(result.candidates.map((candidate) => candidate.kernel), [
    Kernels.MIHOMO,
    Kernels.SING_BOX,
    Kernels.XRAY,
  ]);
  assert.ok(result.candidates.every((candidate) => candidate.ok));
});

test("honors explicit kernel preference without bypassing capability checks", () => {
  const result = createUnifiedKernelSelection(VLESS, {
    preferredKernels: [Kernels.XRAY],
  });
  assert.equal(result.ok, true);
  assert.equal(result.selected.kernel, Kernels.XRAY);
});

test("fixed kernel remains authoritative", () => {
  assert.equal(selectUnifiedKernel(VLESS, { kernel: Kernels.XRAY }), Kernels.XRAY);
});

test("unsupported protocol produces an explainable result", () => {
  const result = createUnifiedKernelSelection({
    protocol: "unknown-protocol",
    server: "example.com",
    port: 443,
  });
  assert.equal(result.ok, false);
  assert.equal(result.selected, null);
  assert.match(result.reason, /no kernel/i);
});
