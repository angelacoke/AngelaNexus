import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeProbeResult } from "../src/core/runtime-probe.js";

test("zero exit is supported", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({ code: 0, stdout: "", stderr: "" }),
    { status: "supported", reason: "runtime accepted configuration" }
  );
});

test("explicit unknown outbound is rejected", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({ code: 1, stdout: "", stderr: "unknown outbound type: wireguard" }),
    { status: "rejected", reason: "runtime explicitly rejected the capability" }
  );
});

test("sing-box legacy WireGuard schema rejection is not treated as fixture corruption", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({
      code: 1,
      stdout: "",
      stderr: 'decode config: outbounds[0].server: json: unknown field "server"'
    }),
    { status: "rejected", reason: "runtime explicitly rejected the capability" }
  );
});

test("invalid fixture is not reported as unsupported", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({ code: 1, stdout: "", stderr: "invalid private key" }),
    { status: "invalid-fixture", reason: "runtime reported invalid probe configuration" }
  );
});

test("unclassified nonzero exit is an execution error", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({ code: 1, stdout: "", stderr: "permission denied" }),
    { status: "execution-error", reason: "runtime failed without an explicit capability or fixture diagnosis" }
  );
});

test("abnormal process termination is an execution error", () => {
  assert.deepEqual(
    classifyRuntimeProbeResult({ code: null, stdout: "", stderr: "" }),
    { status: "execution-error", reason: "process did not exit normally" }
  );
});
