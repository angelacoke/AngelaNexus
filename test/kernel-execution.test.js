import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKernelExecution } from "../src/core/kernel-execution.js";
import { Kernels } from "../src/core/model.js";

function fakeRuntimeFactory(kernel, options) {
  return {
    kernel,
    options,
    running: false,
    async start() { this.running = true; return { kernel, status: "starting" }; },
    async stop() { this.running = false; return { kernel, status: "stopped" }; },
    async reload() { return { kernel, status: "reloading" }; },
    async status() { return { kernel, running: this.running }; },
    async logs() { return []; }
  };
}

test("creates a compiled kernel execution with restrictive config permissions", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "nexus-execution-test-"));
  try {
    const execution = await createKernelExecution({
      kernel: Kernels.SING_BOX,
      nodes: [{
        id: "exit",
        protocol: "socks",
        server: "192.0.2.1",
        port: 1080
      }]
    }, {
      binary: "/usr/bin/sing-box",
      workdir,
      runtimeFactory: fakeRuntimeFactory
    });

    assert.equal(execution.kernel, Kernels.SING_BOX);
    assert.match(execution.configPath, /config\.json$/);
    const mode = (await stat(execution.configPath)).mode & 0o777;
    assert.equal(mode, 0o600);
    const config = JSON.parse(await readFile(execution.configPath, "utf8"));
    assert.equal(config.outbounds[0].tag, "exit");

    const started = await execution.start();
    assert.equal(started.status, "starting");
    assert.equal((await execution.status()).running, true);
    await execution.stop();
    assert.equal((await execution.status()).running, false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("does not create an execution when unified config preflight fails", async () => {
  await assert.rejects(
    createKernelExecution({
      kernel: Kernels.SING_BOX,
      nodes: [{
        id: "bad",
        protocol: "nexus-unknown",
        server: "example.com",
        port: 443
      }]
    }, { binary: "/usr/bin/sing-box", runtimeFactory: fakeRuntimeFactory }),
    /configuration preflight failed/
  );
});

test("native runtime selection requires an actual native runtime factory", async () => {
  await assert.rejects(
    createKernelExecution({
      kernel: Kernels.MIHOMO,
      nodes: [{
        id: "exit",
        protocol: "socks",
        server: "192.0.2.1",
        port: 1080
      }]
    }, {
      binary: "/usr/bin/mihomo",
      platform: "android",
      runtimeFactory: fakeRuntimeFactory
    }),
    /native runtime selected but nativeRuntimeFactory is unavailable/
  );
});

test("explicit process runtime remains available when requested", async () => {
  const execution = await createKernelExecution({
    kernel: Kernels.MIHOMO,
    nodes: [{
      id: "exit",
      protocol: "socks",
      server: "192.0.2.1",
      port: 1080
    }]
  }, {
    binary: "/usr/bin/mihomo",
    platform: "android",
    requestedRuntimeMode: "process",
    runtimeFactory: fakeRuntimeFactory
  });
  assert.equal(execution.runtimeMode, "process");
  await execution.stop();
});


test("execution honors a ready runtime plan without re-resolving runtime mode", async () => {
  const execution = await createKernelExecution({
    kernel: Kernels.MIHOMO,
    nodes: [{
      id: "exit",
      protocol: "socks",
      server: "192.0.2.1",
      port: 1080
    }]
  }, {
    binary: "/usr/bin/mihomo",
    runtimePlan: {
      ok: true,
      plan: {
        kind: "runtime-plan",
        version: 2,
        kernel: Kernels.MIHOMO,
        runtime: { platform: "android", selectedMode: "process" }
      }
    },
    runtimeFactory: fakeRuntimeFactory
  });
  assert.equal(execution.runtimeMode, "process");
  await execution.stop();
});

test("execution rejects a runtime plan that conflicts with the kernel", async () => {
  await assert.rejects(
    createKernelExecution({
      kernel: Kernels.MIHOMO,
      nodes: [{
        id: "exit",
        protocol: "socks",
        server: "192.0.2.1",
        port: 1080
      }]
    }, {
      binary: "/usr/bin/mihomo",
      runtimePlan: {
        ok: true,
        plan: {
          kind: "runtime-plan",
          version: 2,
          kernel: Kernels.SING_BOX,
          runtime: { platform: "android", selectedMode: "process" }
        }
      },
      runtimeFactory: fakeRuntimeFactory
    }),
    /runtimePlan kernel does not match execution kernel/
  );
});
