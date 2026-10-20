import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { assertTargetResponse, buildTrafficConfig, createSocks5Probe, DEFAULT_BINARIES, runKernelTrafficSmoke } from "../scripts/kernel-traffic-smoke.mjs";
import { Kernels } from "../src/core/model.js";

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}

test("traffic smoke defaults only to NEXUS_*_BIN and reports missing values", () => {
  assert.equal(DEFAULT_BINARIES[Kernels.MIHOMO], process.env.NEXUS_MIHOMO_BIN);
  assert.equal(DEFAULT_BINARIES[Kernels.SING_BOX], process.env.NEXUS_SING_BOX_BIN);
  assert.equal(DEFAULT_BINARIES[Kernels.XRAY], process.env.NEXUS_XRAY_BIN);
});

test("traffic smoke does not accept a marker from a non-success or altered response", () => {
  const response = body => `HTTP/1.1 200 OK\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  assert.doesNotThrow(() => assertTargetResponse(response("ANGELANEXUS_LOOPBACK_OK")));
  assert.throws(() => assertTargetResponse(response("ANGELANEXUS_LOOPBACK_OK").replace("ANGELANEXUS_LOOPBACK_OK", "prefix ANGELANEXUS_LOOPBACK_OK")), /unexpected target response body/);
  assert.throws(() => assertTargetResponse(response("ANGELANEXUS_LOOPBACK_OK").replace("200 OK", "404 Not Found")), /unexpected target status/);
  assert.throws(() => assertTargetResponse(response("ANGELANEXUS_LOOPBACK_OK").replace(/content-length: \d+/, "content-length: 999")), /unexpected target content-length/);
});

test("traffic smoke rejects missing binaries and cleans up local fixtures", { timeout: 5000 }, async () => {
  await assert.rejects(runKernelTrafficSmoke({ binaries: {}, kernels: [Kernels.MIHOMO] }), /missing NEXUS_MIHOMO_BIN/);
});

test("traffic smoke handles executable spawn failures without hanging", { timeout: 5000 }, async () => {
  await assert.rejects(runKernelTrafficSmoke({
    binaries: { [Kernels.MIHOMO]: "/nonexistent-angelanexus-kernel/never" },
    kernels: [Kernels.MIHOMO],
  }), /kernel process could not start|kernel exited before listening/);
});

test("traffic smoke configs come from compileUnifiedConfig and retain canonical default routing", () => {
  for (const kernel of Object.values(Kernels)) {
    const config = buildTrafficConfig(kernel, 23456, 24567);
    if (kernel === Kernels.MIHOMO) {
      assert.equal(config.proxies[0].type, "socks5");
      assert.ok(config.rules.some(rule => rule.includes("loopback-upstream")));
      assert.equal(config["mixed-port"], 24567);
      assert.equal(config["bind-address"], "127.0.0.1");
    } else if (kernel === Kernels.SING_BOX) {
      assert.equal(config.outbounds[0].type, "socks");
      assert.equal(config.route.final, "loopback-upstream");
      assert.ok(config.route.rules.some(rule => rule.outbound === "loopback-upstream"));
      assert.equal(config.inbounds[0].listen_port, 24567);
    } else {
      assert.equal(config.outbounds[0].protocol, "socks");
      assert.ok(config.routing.rules.some(rule => rule.outboundTag === "loopback-upstream"));
      assert.ok(config.routing.rules.some(rule => rule.inboundTag?.includes("traffic-smoke")));
      assert.equal(config.inbounds[0].port, 24567);
    }
  }
});

test("local SOCKS fixture records independent connections and rejects new connections", async () => {
  const target = net.createServer(socket => socket.end("target"));
  const accepting = createSocks5Probe();
  const rejecting = createSocks5Probe({ accept: false });
  const targetPort = await listen(target);
  const acceptingPort = await listen(accepting.server);
  const rejectingPort = await listen(rejecting.server);
  const request = port => new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.write(Buffer.from([5, 1, 0]));
      socket.once("data", greeting => {
        if (greeting[1] !== 0) return reject(new Error("SOCKS greeting rejected"));
        const packet = Buffer.from([5, 1, 0, 1, 127, 0, 0, 1, targetPort >> 8, targetPort & 255]);
        socket.write(packet);
        socket.once("data", () => { socket.destroy(); resolve(); });
      });
    });
    socket.once("error", reject);
    socket.once("close", () => resolve());
  });
  try {
    await request(acceptingPort);
    assert.equal(accepting.connections.length, 1);
    const beforeConnections = rejecting.connections.length;
    let beforeTarget = 0;
    target.on("connection", () => { beforeTarget += 1; });
    await request(rejectingPort);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(rejecting.connections.length, beforeConnections);
    assert.equal(beforeTarget, 0);
  } finally {
    await Promise.all([target, accepting.server, rejecting.server].map(server => new Promise(resolve => server.close(() => resolve()))));
  }
});

const targetBody = "ANGELANEXUS_LOOPBACK_OK";
const targetLength = Buffer.byteLength(targetBody);
for (const [name, headers, error] of [
  ["missing length", "content-type: text/plain", /content-length/],
  ["numeric prefix with junk", `Content-Length: ${targetLength}junk`, /content-length/],
  ["duplicate length", `Content-Length: ${targetLength}\r\nContent-Length: ${targetLength}`, /content-length/],
  ["conflicting length", `Content-Length: ${targetLength}\r\nContent-Length: 0`, /content-length/],
  ["ambiguous transfer encoding", `Content-Length: ${targetLength}\r\nTransfer-Encoding: chunked`, /transfer-encoding/],
]) {
  test(`traffic smoke rejects ${name} even with the exact target body`, () => {
    assert.throws(() => assertTargetResponse(`HTTP/1.1 200 OK\r\n${headers}\r\n\r\n${targetBody}`), error);
  });
}

test("traffic smoke accepts case-insensitive Content-Length with surrounding whitespace", () => {
  assert.doesNotThrow(() => assertTargetResponse(`HTTP/1.1 200 OK\r\nCONTENT-LENGTH: \t${targetLength} \r\n\r\n${targetBody}`));
});
