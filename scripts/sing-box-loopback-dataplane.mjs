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
  res.end(`${expectedBody} ${req.url}`);
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

function connectProxy() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function requestHttpProxy() {
  return new Promise(async (resolve, reject) => {
    let socket;
    try {
      socket = await connectProxy();
      let response = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timed out waiting for HTTP response through sing-box"));
      }, 5000);
      socket.setEncoding("utf8");
      socket.on("data", chunk => { response += chunk; });
      socket.once("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("close", () => {
        clearTimeout(timer);
        resolve(response);
      });
      socket.write(`GET http://127.0.0.1:${targetPort}/health HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
    } catch (error) {
      socket?.destroy();
      reject(error);
    }
  });
}

async function requestSocks5() {
  const socket = await connectProxy();
  socket.setTimeout(5000, () => socket.destroy(new Error("SOCKS5 request timed out")));
  let buffered = Buffer.alloc(0);
  const waiters = [];
  socket.on("error", error => {
    while (waiters.length) waiters.shift().reject(error);
  });
  socket.on("data", chunk => {
    buffered = Buffer.concat([buffered, chunk]);
    while (waiters.length && buffered.length >= waiters[0].length) {
      const waiter = waiters.shift();
      const result = buffered.subarray(0, waiter.length);
      buffered = buffered.subarray(waiter.length);
      waiter.resolve(result);
    }
  });
  function read(length) {
    if (buffered.length >= length) {
      const result = buffered.subarray(0, length);
      buffered = buffered.subarray(length);
      return Promise.resolve(result);
    }
    return new Promise((resolve, reject) => waiters.push({ length, resolve, reject }));
  }
  try {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await read(2);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
      throw new Error(`SOCKS5 no-auth negotiation failed: ${greeting.toString("hex")}`);
    }
    const port = Buffer.from([targetPort >> 8, targetPort & 0xff]);
    socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1]), port]));
    const reply = await read(4);
    if (reply[0] !== 0x05 || reply[1] !== 0x00) {
      throw new Error(`SOCKS5 connect failed with reply ${reply[1]}`);
    }
    const addressLength = reply[3] === 0x01 ? 4 : reply[3] === 0x04 ? 16 : reply[3] === 0x03 ? (await read(1))[0] : -1;
    if (addressLength < 0) throw new Error(`Unsupported SOCKS5 address type ${reply[3]}`);
    await read(addressLength + 2);
    socket.write(`GET /socks-health HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`);
    const chunks = [];
    for await (const chunk of socket) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    socket.destroy();
  }
}

function assertResponse(label, response, path) {
  if (!response.includes("200 OK") || !response.includes(`${expectedBody} ${path}`)) {
    throw new Error(`${label} data-plane probe returned an unexpected response: ${response.slice(0, 500)}`);
  }
}

try {
  let httpResponse = "";
  let lastError;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`sing-box exited before proxy became ready (code ${child.exitCode}):\n${childOutput}`);
    }
    try {
      httpResponse = await requestHttpProxy();
      assertResponse("HTTP proxy", httpResponse, "/health");
      break;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assertResponse("HTTP proxy", httpResponse, "/health");
  const socksResponse = await requestSocks5();
  assertResponse("SOCKS5", socksResponse, "/socks-health");
  console.log(JSON.stringify({
    kernel: "sing-box",
    version: "1.14.3",
    inbound: "mixed HTTP and SOCKS5 proxy on loopback",
    outbound: "direct",
    target: "local HTTP fixture",
    status: "passed",
    assertions: [
      "HTTP absolute-form request received HTTP 200 and the expected path-specific body",
      "SOCKS5 CONNECT tunnel received HTTP 200 and the expected path-specific body"
    ]
  }, null, 2));
} catch (error) {
  throw new Error(`${error.message}\nLast startup/probe error: ${lastErrorMessage()}\n${childOutput}`);
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

function lastErrorMessage() {
  return typeof lastError === "undefined" ? "none" : String(lastError?.message ?? lastError);
}
