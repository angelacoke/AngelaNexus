import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const binary = process.env.NEXUS_SING_BOX_BIN;
if (!binary) throw new Error("NEXUS_SING_BOX_BIN must point to the verified sing-box binary");

const expectedBody = "AngelaNexus sing-box loopback data-plane OK";
const target = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain", "connection": "close" });
  res.end(expectedBody);
});
await new Promise((resolve, reject) => {
  target.once("error", reject);
  target.listen(0, "127.0.0.1", resolve);
});
const targetPort = target.address().port;

const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const proxyPort = probe.address().port;
await new Promise(resolve => probe.close(resolve));

const dir = await mkdtemp(join(tmpdir(), "nexus-sing-box-dataplane-"));
const configPath = join(dir, "config.json");
await writeFile(configPath, JSON.stringify({
  log: { level: "error", timestamp: true },
  inbounds: [{
    type: "mixed",
    tag: "nexus-test-in",
    listen: "127.0.0.1",
    listen_port: proxyPort
  }],
  outbounds: [{ type: "direct", tag: "nexus-test-direct" }],
  route: { final: "nexus-test-direct" }
}, null, 2));

const child = spawn(binary, ["run", "-c", configPath], { stdio: ["ignore", "pipe", "pipe"] });
let childOutput = "";
child.stdout.on("data", chunk => { childOutput += chunk.toString(); });
child.stderr.on("data", chunk => { childOutput += chunk.toString(); });

function requestThroughProxy() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    let response = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for HTTP response through sing-box"));
    }, 5000);
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`GET http://127.0.0.1:${targetPort}/health HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", chunk => { response += chunk; });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

try {
  let response = "";
  let lastError;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`sing-box exited before proxy became ready (code ${child.exitCode}):\n${childOutput}`);
    }
    try {
      response = await requestThroughProxy();
      if (response.includes(`200 OK`) && response.includes(expectedBody)) break;
      lastError = new Error("proxy returned an unexpected response: " + response.slice(0, 500));
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!response.includes("200 OK") || !response.includes(expectedBody)) {
    throw new Error(`sing-box loopback data-plane probe failed: ${lastError?.message ?? "no response"}\n${childOutput}`);
  }
  console.log(JSON.stringify({
    kernel: "sing-box",
    version: "1.14.3",
    inbound: "mixed HTTP proxy on loopback",
    outbound: "direct",
    target: "local HTTP fixture",
    status: "passed",
    assertion: "HTTP 200 and expected body traversed sing-box"
  }, null, 2));
} finally {
  if (child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await new Promise(resolve => target.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
