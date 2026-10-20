import test from "node:test";
import assert from "node:assert/strict";
import { importConfig } from "../src/core/import-pipeline.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const fixtures = [
  ["VLESS", `vless://${uuid}@edge.example:443?security=tls&type=ws&sni=edge.example&path=%2Fws#vless-node`, uuid],
  ["Trojan", "trojan://fixture-password@edge.example:443?security=tls#trojan-node", "fixture-password"],
  ["Shadowsocks", `ss://${Buffer.from("aes-128-gcm:fixture-password").toString("base64")}@edge.example:8388#ss-node`, "fixture-password"],
];

for (const [protocol, input, credential] of fixtures) {
  for (const kernel of ["mihomo", "sing-box", "xray"]) {
    test(`${protocol} link retains authentication in ${kernel} runtime handoff`, () => {
      const result = importConfig(input, { kernel, prepareRuntimeHandoff: true });
      assert.equal(result.model.nodeCount, 1);
      assert.equal(result.runtimeHandoff.kernel, kernel);
      assert.equal(result.runtimeHandoff.compilerValidation.ok, true);
      assert.ok(result.runtimeHandoff.configuration.includes(credential));
      assert.ok(result.runtimeHandoff.configuration.includes("edge.example"));
      assert.equal(result.runtimeHandoff.executionIntent.mode, "proxy");
      if (protocol === "VLESS") {
        assert.ok(result.runtimeHandoff.configuration.includes("/ws"));
        assert.ok(result.runtimeHandoff.configuration.includes("tls"));
      }
    });
  }
}

test("TLS fingerprint and gRPC service name survive the full runtime compilation path", () => {
  const input = `vless://${uuid}@edge.example:443?security=tls&type=grpc&serviceName=fixture-service&fp=chrome#grpc-node`;
  const result = importConfig(input, { kernel: "sing-box", prepareRuntimeHandoff: true });
  assert.equal(result.model.nodes[0].tls.fingerprint, "chrome");
  assert.equal(result.model.nodes[0].transport.serviceName, "fixture-service");
  const outbound = JSON.parse(result.runtimeHandoff.configuration).outbounds.find((item) => item.type === "vless");
  assert.equal(outbound.transport.service_name, "fixture-service");
  assert.equal(outbound.tls.utls.fingerprint, "chrome");
});
