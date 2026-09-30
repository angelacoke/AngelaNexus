import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSPARENT_CAPTURE_TYPES,
  TRANSPARENT_FLOW_STATES,
  createTransparentNetworkContract,
  evaluateTransparentNetwork,
  createCapturedFlow,
  resolveTransparentFlowPolicy,
  createTransparentIngressDecision,
} from "../src/platform/transparent-network.js";

function activeRuntime(overrides = {}) {
  return {
    tcp: true, udp: true, dns: true, icmp: true, ipv4: true, ipv6: true,
    permission: true, active: true,
    appIdentity: true, processIdentity: true, uidIdentity: true, domainIdentity: true,
    ...overrides,
  };
}

test("T1 application transparency: no proxy configuration is required", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  assert.equal(contract.routing.noProxyConfigurationRequired, true);
  const flow = createCapturedFlow({ protocol: TRANSPARENT_CAPTURE_TYPES.TCP, destinationIp: "1.2.3.4", destinationPort: 443 });
  const decision = createTransparentIngressDecision(contract, activeRuntime(), flow);
  assert.equal(decision.action, "platform-routing");
});

test("T2 network transparency: TCP UDP DNS IPv4 IPv6 are explicit capture capabilities", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  const evaluation = evaluateTransparentNetwork(contract, activeRuntime());
  assert.equal(evaluation.state, TRANSPARENT_FLOW_STATES.ROUTABLE);
  assert.deepEqual(evaluation.identity, { app: true, process: true, uid: true, domain: true });
});

test("T3 identity preservation: app process UID and domain survive the ingress boundary", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  const flow = createCapturedFlow({
    protocol: "tcp", sourceIp: "10.0.0.2", destinationIp: "2001:db8::10",
    destinationPort: 443, destinationDomain: "example.test",
    packageName: "app.example", processName: "example", uid: "10042",
  });
  assert.equal(flow.identity.packageName, "app.example");
  assert.equal(flow.identity.processName, "example");
  assert.equal(flow.identity.uid, "10042");
  assert.equal(flow.destination.domain, "example.test");
});

test("T4 path transparency: ingress hands off to platform routing rather than exposing a proxy endpoint", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  const flow = createCapturedFlow({ protocol: "udp", destinationIp: "1.2.3.4", destinationPort: 443 });
  const decision = createTransparentIngressDecision(contract, activeRuntime(), flow);
  assert.equal(decision.target, "platform-routing");
  assert.equal(contract.routing.handoff, "platform-routing");
});

test("T5 leak transparency: capability loss rejects instead of silently going direct", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  const decision = createTransparentIngressDecision(contract, activeRuntime({ ipv6: false }), {
    protocol: "tcp", destinationIp: "2001:db8::10", destinationPort: 443,
  });
  assert.equal(decision.action, "reject");
  assert.equal(decision.failClosed, true);
  assert.equal(contract.security.allowSilentDirectFallback, false);
});

test("T6 loop transparency: internal control and resolver paths never re-enter user routing", () => {
  const contract = createTransparentNetworkContract({ enabled: true });
  const flow = createCapturedFlow({
    protocol: "udp", destinationIp: "127.0.0.1", destinationPort: 53,
    originatedByAngelaNexus: true, resolverTraffic: true,
  });
  const policy = resolveTransparentFlowPolicy(contract, flow);
  assert.equal(policy.action, "internal-protected-path");
  assert.equal(policy.state, TRANSPARENT_FLOW_STATES.EXCLUDED);
});

test("T7 platform transparency: capability boundaries are evaluated by the adapter, not guessed", () => {
  const contract = createTransparentNetworkContract({ enabled: true, icmp: true });
  const evaluation = evaluateTransparentNetwork(contract, activeRuntime({ icmp: false }));
  assert.equal(evaluation.state, TRANSPARENT_FLOW_STATES.REJECTED);
  assert.equal(evaluation.active, false);
  assert.deepEqual(evaluation.unsupported, ["icmp"]);
});

test("explicit app exclusions are represented without creating a hidden direct fallback", () => {
  const contract = createTransparentNetworkContract({
    enabled: true, excludePackages: ["app.local"],
  });
  const policy = resolveTransparentFlowPolicy(contract, createCapturedFlow({
    protocol: "tcp", destinationIp: "192.168.1.2", destinationPort: 443,
    packageName: "app.local",
  }));
  assert.equal(policy.action, "user-excluded");
  assert.equal(policy.failClosed, true);
});
