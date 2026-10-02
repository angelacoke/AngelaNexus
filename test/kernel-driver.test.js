import test from "node:test";
import assert from "node:assert/strict";
import { Kernels } from "../src/core/model.js";
import { createNodeProfile } from "../src/platform/node-profile.js";
import { createPipelineSpec } from "../src/platform/pipeline-spec.js";
import { driverFor, describeKernelDrivers } from "../src/kernel/driver-registry.js";
import { KernelDriverCapabilities } from "../src/kernel/driver-contract.js";

const node = {
  id: "node-1",
  protocol: "vless",
  server: "example.com",
  port: 443,
  uuid: "00000000-0000-0000-0000-000000000001",
  tls: { enabled: true, serverName: "example.com" },
};

for (const kernel of Object.values(Kernels)) {
  test(kernel + " is a peer kernel driver", () => {
    const driver = driverFor(kernel);
    assert.ok(driver);
    assert.equal(driver.kernel, kernel);
    assert.equal(typeof driver.compileNode, "function");
    assert.equal(typeof driver.compilePipeline, "function");
    assert.equal(typeof driver.createRuntime, "function");
    assert.equal(driver.capabilities.includes(KernelDriverCapabilities.NODE_COMPILE), true);
  });
}

test("driver registry has no default or main kernel", () => {
  const descriptions = describeKernelDrivers();
  assert.deepEqual(descriptions.map((item) => item.kernel).sort(), Object.values(Kernels).sort());
  assert.equal("defaultKernel" in Object.fromEntries(descriptions.map((item) => [item.kernel, item])), false);
  assert.equal("mainKernel" in Object.fromEntries(descriptions.map((item) => [item.kernel, item])), false);
});

test("Mihomo native runtime capability is platform-scoped", () => {
  const driver = driverFor(Kernels.MIHOMO);
  assert.equal(driver.capabilities.includes(KernelDriverCapabilities.NATIVE_RUNTIME), true);
  assert.deepEqual(driver.match({
    runtime: { selectedMode: "native", platform: "android" },
  }), {
    preference: "native-runtime",
    reason: "registered native runtime capability matches the selected platform",
  });
  assert.equal(driver.match({
    runtime: { selectedMode: "native", platform: "windows" },
  }).compatible, false);
});

test("sing-box and Xray do not advertise native runtime capability", () => {
  for (const kernel of [Kernels.SING_BOX, Kernels.XRAY]) {
    const driver = driverFor(kernel);
    assert.equal(driver.capabilities.includes(KernelDriverCapabilities.NATIVE_RUNTIME), false);
    assert.equal(driver.match({
      runtime: { selectedMode: "native", platform: "android" },
    }).compatible, false);
  }
});

test("native runtime creation is fail-closed without the platform factory", () => {
  assert.throws(
    () => driverFor(Kernels.MIHOMO).createRuntime({
      runtimeMode: "native",
      platform: "android",
    }),
    /nativeRuntimeFactory is unavailable/,
  );
});

test("platform NodeProfile is kernel-neutral", () => {
  const profile = createNodeProfile(node);
  assert.equal(profile.protocol, "vless");
  assert.equal("kernel" in profile, false);
  assert.equal(profile.endpoint.server, "example.com");
});

test("PipelineSpec models arbitrary parallel kernel hops without fixed roles", () => {
  const profile = createNodeProfile(node);
  const spec = createPipelineSpec({
    id: "mixed-pipeline",
    hops: [
      { id: "first", kernel: Kernels.SING_BOX, node: profile, listen: { host: "127.0.0.1", port: 41001 } },
      { id: "second", kernel: Kernels.XRAY, node: profile, listen: { host: "127.0.0.1", port: 41002 } },
    ],
  });
  assert.equal(spec.hops.length, 2);
  assert.equal(spec.hops[0].kernel, Kernels.SING_BOX);
  assert.equal(spec.hops[1].kernel, Kernels.XRAY);
  assert.equal("entry" in spec, false);
  assert.equal("relay" in spec, false);
  assert.equal("exit" in spec, false);
});

test("each driver compiles only its own kernel-native node config", () => {
  const profile = createNodeProfile(node);
  for (const kernel of Object.values(Kernels)) {
    const driver = driverFor(kernel);
    const compiled = driver.compileNode(profile);
    assert.ok(compiled);
    if (kernel === Kernels.MIHOMO) assert.ok(Array.isArray(compiled.proxies));
    if (kernel === Kernels.SING_BOX) assert.ok(Array.isArray(compiled.outbounds));
    if (kernel === Kernels.XRAY) assert.ok(Array.isArray(compiled.outbounds));
  }
});

test("pipeline compilation is kernel-local", () => {
  const profile = createNodeProfile(node);
  const spec = createPipelineSpec({
    id: "singbox-xray",
    hops: [
      { id: "sb", kernel: Kernels.SING_BOX, node: profile, listen: { host: "127.0.0.1", port: 42001 } },
      { id: "xr", kernel: Kernels.XRAY, node: profile, listen: { host: "127.0.0.1", port: 42002 } },
    ],
  });
  const singBox = driverFor(Kernels.SING_BOX).compilePipeline(spec);
  const xray = driverFor(Kernels.XRAY).compilePipeline(spec);
  assert.equal(singBox.kernel, Kernels.SING_BOX);
  assert.equal(xray.kernel, Kernels.XRAY);
  assert.notEqual(singBox.config, xray.config);
  assert.equal(singBox.listen.port, 42001);
  assert.equal(xray.listen.port, 42002);
});
