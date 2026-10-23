import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import yaml from "js-yaml";
import { compileUnifiedConfig } from "../src/core/config-compiler.js";
import { Kernels } from "../src/core/model.js";

const LOG_LIMIT = 64 * 1024;
const START_TIMEOUT = 12_000;
const REQUEST_TIMEOUT = 8_000;
const CLEANUP_TIMEOUT = 4_000;
const TARGET_BODY = "ANGELANEXUS_LOOPBACK_OK";

export const DEFAULT_BINARIES = Object.freeze({
  [Kernels.MIHOMO]: process.env.NEXUS_MIHOMO_BIN,
  [Kernels.SING_BOX]: process.env.NEXUS_SING_BOX_BIN,
  [Kernels.XRAY]: process.env.NEXUS_XRAY_BIN
});

function withTimeout(operation, ms, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve().then(operation), deadline]).finally(() => clearTimeout(timer));
}

function listen(server, host = "127.0.0.1") {
  return withTimeout(() => new Promise((resolve, reject) => {
    const onError = error => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(server.address().port); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, host);
  }), START_TIMEOUT, "server startup");
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  await withTimeout(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }), CLEANUP_TIMEOUT, "server cleanup");
}

function appendBounded(current, chunk) {
  const text = current + chunk.toString();
  return text.length <= LOG_LIMIT ? text : text.slice(-LOG_LIMIT);
}

function missingBinary(kernel, binaries) {
  const variable = { [Kernels.MIHOMO]: "NEXUS_MIHOMO_BIN", [Kernels.SING_BOX]: "NEXUS_SING_BOX_BIN", [Kernels.XRAY]: "NEXUS_XRAY_BIN" }[kernel];
  if (!binaries?.[kernel]) throw new Error(`missing ${variable}; set it to the ${kernel} executable (loopback smoke does not choose a default)`);
  return binaries[kernel];
}

export function createSocks5Probe({ accept = true } = {}) {
  const connections = [];
  const sockets = new Set();
  let accepting = accept;
  const server = net.createServer(socket => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let stage = "greeting";
    let upstream;
    socket.once("close", () => { sockets.delete(socket); upstream?.destroy(); });
    const fail = () => { upstream?.destroy(); socket.destroy(); };
    socket.on("error", fail);
    socket.on("data", chunk => {
      if (stage === "relay") return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > LOG_LIMIT) return fail();
      if (stage === "greeting") {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        if (buffer[0] !== 5 || !accepting) return fail();
        buffer = buffer.subarray(2 + buffer[1]);
        socket.write(Buffer.from([5, 0]));
        stage = "request";
      }
      if (stage !== "request" || buffer.length < 10) return;
      if (buffer[0] !== 5 || buffer[1] !== 1 || buffer[3] !== 1) return fail();
      const host = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
      const port = buffer.readUInt16BE(8);
      if (host !== "127.0.0.1") return fail();
      buffer = buffer.subarray(10);
      stage = "relay";
      const startedAt = Date.now();
      upstream = net.connect(port, host);
      upstream.once("connect", () => {
        connections.push({ host, port, elapsedMs: Date.now() - startedAt });
        socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        if (buffer.length) upstream.write(buffer);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      upstream.once("error", fail);
    });
  });
  return {
    server,
    connections,
    sockets,
    rejectNewConnections() { accepting = false; },
    allowNewConnections() { accepting = true; },
    closeConnections() { for (const socket of sockets) socket.destroy(); }
  };
}

function canonicalConfig(kernel, upstreamPort) {
  return {
    kernel,
    nodes: [{ id: "loopback-upstream", name: "loopback-upstream", protocol: "socks", server: "127.0.0.1", port: upstreamPort }],
    routing: {
      rules: [{ id: "traffic-smoke-inbound", name: "traffic-smoke-inbound", match: { inbound: "traffic-smoke" }, action: { type: "route", target: "loopback-upstream" } }],
      defaultAction: { type: "route", target: "loopback-upstream" }
    }
  };
}

export function buildTrafficConfig(kernel, upstreamPort, inboundPort) {
  const compiled = compileUnifiedConfig(canonicalConfig(kernel, upstreamPort), kernel).config;
  if (kernel === Kernels.MIHOMO) {
    return { ...compiled, "mixed-port": inboundPort, "allow-lan": false, "bind-address": "127.0.0.1" };
  }
  if (kernel === Kernels.SING_BOX) {
    return { ...compiled, inbounds: [{ type: "mixed", tag: "traffic-smoke", listen: "127.0.0.1", listen_port: inboundPort }] };
  }
  return { ...compiled, inbounds: [{ listen: "127.0.0.1", port: inboundPort, protocol: "socks", settings: { auth: "noauth", udp: false }, tag: "traffic-smoke" }] };
}

async function httpViaProxy(port, targetPort) {
  let socket;
  try {
    return await withTimeout(() => new Promise((resolve, reject) => {
      socket = net.connect(port, "127.0.0.1");
      let data = "";
      socket.once("connect", () => socket.write(`GET http://127.0.0.1:${targetPort}/traffic-smoke HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nConnection: close\r\n\r\n`));
      socket.on("data", chunk => {
        data += chunk.toString();
        if (data.length > LOG_LIMIT) reject(new Error("HTTP response exceeds smoke limit"));
      });
      socket.once("end", () => resolve(data));
      socket.once("error", reject);
      socket.once("close", () => resolve(data));
    }), REQUEST_TIMEOUT, "HTTP request");
  } finally {
    socket?.destroy();
  }
}

export function assertTargetResponse(response, kernel = "kernel") {
  const separator = response.indexOf("\r\n\r\n");
  if (separator < 0) throw new Error(`${kernel}: incomplete HTTP response headers`);
  const headerLines = response.slice(0, separator).split("\r\n");
  const status = headerLines[0];
  if (status !== "HTTP/1.1 200 OK") throw new Error(`${kernel}: unexpected target status ${status || "missing"}`);
  const contentLengths = headerLines.filter(line => /^content-length\s*:/i.test(line));
  const lengthValue = contentLengths[0]?.split(":").slice(1).join(":").trim();
  const expectedLength = Buffer.byteLength(TARGET_BODY);
  if (contentLengths.length !== 1 || !/^\d+$/.test(lengthValue ?? "") || Number(lengthValue) !== expectedLength) {
    throw new Error(`${kernel}: unexpected target content-length`);
  }
  if (headerLines.some(line => /^transfer-encoding\s*:/i.test(line))) {
    throw new Error(`${kernel}: unexpected target transfer-encoding`);
  }
  if (response.slice(separator + 4) !== TARGET_BODY) throw new Error(`${kernel}: unexpected target response body`);
}

function startProcess(bin, args) {
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.on("data", chunk => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on("data", chunk => { stderr = appendBounded(stderr, chunk); });
  child.once("error", error => { spawnError = error; });
  let ended = false;
  const closed = new Promise(resolve => child.once("close", () => { ended = true; resolve(); }));
  return { child, closed, ended: () => ended, error: () => spawnError, logs: () => ({ stdout, stderr }) };
}

async function waitForPort(port, process) {
  await withTimeout(async () => {
    while (process.child.exitCode === null) {
      if (process.error()) throw new Error(`kernel process could not start: ${process.error().message}`);
      try {
        await new Promise((resolve, reject) => {
          const socket = net.connect(port, "127.0.0.1", resolve);
          socket.once("error", reject);
          socket.once("connect", () => socket.destroy());
        });
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    }
    throw new Error(`kernel exited before listening (code=${process.child.exitCode}, signal=${process.child.signalCode})`);
  }, START_TIMEOUT, `kernel startup on 127.0.0.1:${port}`);
}

async function stopProcess(process) {
  if (process.ended()) return;
  if (process.child.pid) process.child.kill("SIGTERM");
  try {
    await withTimeout(() => process.closed, 1_500, "graceful kernel stop");
  } catch {
    if (process.child.pid && !process.ended()) process.child.kill("SIGKILL");
    await withTimeout(() => process.closed, CLEANUP_TIMEOUT, "kernel process cleanup");
  }
}

export async function runKernelTrafficSmoke({ binaries = DEFAULT_BINARIES, kernels = Object.values(Kernels) } = {}) {
  const targetRequests = { count: 0 };
  const target = createServer((req, res) => {
    targetRequests.count += 1;
    if (req.method !== "GET" || req.url !== "/traffic-smoke") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("unexpected target request");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain", "content-length": String(Buffer.byteLength(TARGET_BODY)) });
    res.end(TARGET_BODY);
  });
  const socks = createSocks5Probe();
  const directory = await mkdtemp(join(tmpdir(), "nexus-kernel-traffic-"));
  const report = [];
  try {
    const targetPort = await listen(target);
    const upstreamPort = await listen(socks.server);
    for (const kernel of kernels) {
      const binary = missingBinary(kernel, binaries);
      const reservation = net.createServer();
      const inboundPort = await listen(reservation);
      await closeServer(reservation);
      const configPath = join(directory, `${kernel}.${kernel === Kernels.MIHOMO ? "yaml" : "json"}`);
      await writeFile(configPath, kernel === Kernels.MIHOMO ? yaml.dump(buildTrafficConfig(kernel, upstreamPort, inboundPort)) : JSON.stringify(buildTrafficConfig(kernel, upstreamPort, inboundPort), null, 2));
      const args = kernel === Kernels.MIHOMO ? ["-d", directory, "-f", configPath] : ["run", "-c", configPath];
      const process = startProcess(binary, args);
      const beforeConnections = socks.connections.length;
      const beforeRequests = targetRequests.count;
      try {
        await waitForPort(inboundPort, process);
        const response = await httpViaProxy(inboundPort, targetPort);
        assertTargetResponse(response, kernel);
        if (socks.connections.length <= beforeConnections || targetRequests.count <= beforeRequests) throw new Error(`${kernel}: no independent upstream/target evidence`);
        const beforeRejectedConnections = socks.connections.length;
        const beforeRejectedRequests = targetRequests.count;
        socks.closeConnections();
        await new Promise(resolve => setTimeout(resolve, 50));
        socks.rejectNewConnections();
        let rejectedResponse;
        try {
          rejectedResponse = await httpViaProxy(inboundPort, targetPort);
        } catch {
          // Expected: the kernel must fail closed when its only upstream refuses.
        } finally {
          socks.allowNewConnections();
        }
        if (socks.connections.length !== beforeRejectedConnections || targetRequests.count !== beforeRejectedRequests) throw new Error(`${kernel}: rejected upstream request reached target or opened a connection`);
        if (rejectedResponse?.includes("ANGELANEXUS_LOOPBACK_OK")) throw new Error(`${kernel}: request unexpectedly succeeded while upstream rejected new connections`);
        report.push({ kernel, status: "passed", targetMarker: "ANGELANEXUS_LOOPBACK_OK", upstreamConnections: socks.connections.length - beforeConnections, targetRequests: targetRequests.count - beforeRequests, negativeCheck: "upstream refusal failed closed without target request", ...process.logs() });
      } finally {
        await stopProcess(process);
      }
    }
    return { scope: "Linux loopback-only HTTP/SOCKS data plane; no TUN, Android, or leakage claim", report };
  } finally {
    socks.closeConnections();
    await closeServer(target).catch(() => {});
    await closeServer(socks.server).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runKernelTrafficSmoke().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
