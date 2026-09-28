import { createKernelExecution } from "../src/core/kernel-execution.js";
import { Kernels } from "../src/core/model.js";

const binaries = {
  [Kernels.MIHOMO]: process.env.NEXUS_MIHOMO_BIN,
  [Kernels.SING_BOX]: process.env.NEXUS_SING_BOX_BIN,
  [Kernels.XRAY]: process.env.NEXUS_XRAY_BIN
};

const realityPublicKey = process.env.NEXUS_REALITY_PUBLIC_KEY || "test-public-key";
const fixtures = {
  [Kernels.MIHOMO]: {
    kernel: Kernels.MIHOMO,
    nodes: [{ id: "integration-mihomo", protocol: "vless", server: "example.com", port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: { enabled: true, serverName: "example.com", fingerprint: "chrome",
        reality: { enabled: true, publicKey: realityPublicKey, shortId: "01234567" } } }]
  },
  [Kernels.SING_BOX]: {
    kernel: Kernels.SING_BOX,
    nodes: [{ id: "integration-sing-box", protocol: "vless", server: "example.com", port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: { enabled: true, serverName: "example.com", fingerprint: "chrome",
        reality: { enabled: true, publicKey: realityPublicKey, shortId: "01234567" } },
      transport: { type: "grpc", serviceName: "proxy" } }]
  },
  [Kernels.XRAY]: {
    kernel: Kernels.XRAY,
    nodes: [{ id: "integration-xray", protocol: "vless", server: "example.com", port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: { enabled: true, serverName: "example.com", fingerprint: "chrome",
        reality: { enabled: true, publicKey: realityPublicKey, shortId: "01234567" } },
      transport: { type: "grpc", serviceName: "proxy" } }]
  }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const kernel of Object.values(Kernels)) {
  const binary = binaries[kernel];
  if (!binary) throw new Error("missing binary for " + kernel);

  const execution = await createKernelExecution(fixtures[kernel], { binary });
  let stopped = false;
  try {
    await execution.start();
    await delay(300);
    const status = await execution.status();
    if (!status.running) {
      const logs = await execution.logs({ limit: 20 });
      console.error(JSON.stringify({ kernel, status, logs }, null, 2));
      throw new Error(kernel + " process exited during lifecycle integration test");
    }
  } finally {
    if (!stopped) {
      await execution.stop();
      stopped = true;
    }
  }
  console.log(JSON.stringify({ kernel, status: "started-and-stopped" }));
}
