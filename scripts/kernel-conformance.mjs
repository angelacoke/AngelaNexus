import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { compileUnifiedConfig } from "../src/core/config-compiler.js";
import { Kernels } from "../src/core/model.js";

const fixtures = {
  [Kernels.MIHOMO]: {
    kernel: Kernels.MIHOMO,
    nodes: [{
      id: "mihomo-vless-reality",
      protocol: "vless",
      server: "example.com",
      port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: {
        enabled: true,
        serverName: "example.com",
        fingerprint: "chrome",
        reality: { enabled: true, publicKey: "test-public-key", shortId: "01234567" }
      }
    }]
  },
  [Kernels.SING_BOX]: {
    kernel: Kernels.SING_BOX,
    nodes: [{
      id: "singbox-vless-reality",
      protocol: "vless",
      server: "example.com",
      port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: {
        enabled: true,
        serverName: "example.com",
        fingerprint: "chrome",
        reality: { enabled: true, publicKey: "test-public-key", shortId: "01234567" }
      },
      transport: { type: "grpc", serviceName: "proxy" }
    }]
  },
  [Kernels.XRAY]: {
    kernel: Kernels.XRAY,
    nodes: [{
      id: "xray-vless-reality",
      protocol: "vless",
      server: "example.com",
      port: 443,
      uuid: "00000000-0000-0000-0000-000000000001",
      tls: {
        enabled: true,
        serverName: "example.com",
        fingerprint: "chrome",
        reality: { enabled: true, publicKey: "test-public-key", shortId: "01234567" }
      },
      transport: { type: "grpc", serviceName: "proxy" }
    }]
  }
};

function command(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

const binaries = {
  [Kernels.MIHOMO]: process.env.NEXUS_MIHOMO_BIN,
  [Kernels.SING_BOX]: process.env.NEXUS_SING_BOX_BIN,
  [Kernels.XRAY]: process.env.NEXUS_XRAY_BIN
};
const requireBinaries = process.argv.includes("--require-binaries");
let realityPublicKey = "test-public-key";
if (binaries[Kernels.SING_BOX]) {
  const keyResult = await command(binaries[Kernels.SING_BOX], ["generate", "reality-keypair"]);
  const keyText = keyResult.stdout + "\n" + keyResult.stderr;
  const match = keyText.match(/PublicKey:\s*([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("failed to generate a valid Reality public key with sing-box");
  realityPublicKey = match[1];
}
for (const fixture of Object.values(fixtures)) {
  fixture.nodes[0].tls.reality.publicKey = realityPublicKey;
}
const dir = await mkdtemp(join(tmpdir(), "nexus-kernel-conformance-"));
const report = [];

try {
  for (const kernel of Object.values(Kernels)) {
    const compiled = compileUnifiedConfig(fixtures[kernel]);
    const path = join(dir, kernel === Kernels.MIHOMO ? "config.yaml" : kernel + ".json");
    await writeFile(path, kernel === Kernels.MIHOMO ? yaml.dump(compiled.config) : JSON.stringify(compiled.config, null, 2));

    const bin = binaries[kernel];
    if (!bin) {
      report.push({ kernel, status: "not-run", reason: "binary not configured" });
      continue;
    }

    const args = kernel === Kernels.MIHOMO
      ? ["-t", "-f", path]
      : kernel === Kernels.SING_BOX
        ? ["check", "-c", path]
        : ["run", "-test", "-c", path];

    const result = await command(bin, args);
    const item = {
      kernel,
      status: result.code === 0 ? "passed" : "failed",
      exitCode: result.code,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
    report.push(item);
    if (result.code !== 0) {
      console.error(JSON.stringify(item, null, 2));
      throw new Error(kernel + " runtime validation failed");
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

const wireguardPrivateKey = "UMjI9WbobURkCDh2RT8SRM5osFI7siiR/sPOuuTIDns=";
const wireguardPeerPublicKey = "AIm+QeCoC23zInKASmhu6z/3iaT0R2IKraB7WwYB5ms=";
const wireguardProbeConfigs = {
  [Kernels.MIHOMO]: {
    proxies: [{
      name: "wireguard-probe",
      type: "wireguard",
      private-key: wireguardPrivateKey,
      server: "192.0.2.1",
      port: 51820,
      ip: "10.0.0.2",
      public-key: wireguardPeerPublicKey,
      "allowed-ips": ["0.0.0.0/0"],
      udp: true
    }]
  },
  [Kernels.SING_BOX]: {
    outbounds: [{
      type: "wireguard",
      tag: "wireguard-probe",
      server: "192.0.2.1",
      server_port: 51820,
      local_address: ["10.0.0.2/32"],
      private_key: wireguardPrivateKey,
      peer_public_key: wireguardPeerPublicKey,
      network: "udp"
    }]
  },
  [Kernels.XRAY]: {
    outbounds: [{
      protocol: "wireguard",
      tag: "wireguard-probe",
      settings: {
        secretKey: wireguardPrivateKey,
        address: ["10.0.0.2"],
        peers: [{
          endpoint: "192.0.2.1:51820",
          publicKey: wireguardPeerPublicKey,
          allowedIPs: ["0.0.0.0/0"]
        }],
        noKernelTun: true
      }
    }]
  }
};
const wireguardDir = await mkdtemp(join(tmpdir(), "nexus-wireguard-probe-"));
const wireguardReport = [];
for (const kernel of Object.values(Kernels)) {
  const bin = binaries[kernel];
  if (!bin) {
    wireguardReport.push({ kernel, status: "not-run", reason: "binary not configured" });
    continue;
  }
  const path = join(wireguardDir, kernel === Kernels.MIHOMO ? "wireguard.yaml" : kernel + "-wireguard.json");
  const config = wireguardProbeConfigs[kernel];
  await writeFile(path, kernel === Kernels.MIHOMO ? yaml.dump(config) : JSON.stringify(config, null, 2));
  const args = kernel === Kernels.MIHOMO
    ? ["-t", "-f", path]
    : kernel === Kernels.SING_BOX
      ? ["check", "-c", path]
      : ["run", "-test", "-c", path];
  const result = await command(bin, args);
  wireguardReport.push({
    kernel,
    status: result.code === 0 ? "supported" : "rejected",
    exitCode: result.code,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  });
}
const expectedWireguard = {
  [Kernels.MIHOMO]: "supported",
  [Kernels.SING_BOX]: "rejected",
  [Kernels.XRAY]: "supported"
};
for (const item of wireguardReport) {
  if (item.status === "not-run") continue;
  if (item.status !== expectedWireguard[item.kernel]) {
    console.error(JSON.stringify({ expected: expectedWireguard[item.kernel], actual: item }, null, 2));
    throw new Error(item.kernel + " WireGuard capability probe disagrees with maintained manifest");
  }
}
console.log(JSON.stringify({ runtime: report, wireguard: wireguardReport }, null, 2));
if (requireBinaries && wireguardReport.some(item => item.status === "not-run")) {
  await rm(wireguardDir, { recursive: true, force: true });
  throw new Error("WireGuard capability probe requires all three kernel binaries");
}
await rm(wireguardDir, { recursive: true, force: true });
