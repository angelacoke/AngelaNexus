import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLinuxResolvConf,
  observeLinuxDns,
  syncLinuxDnsObservation,
  evaluateLinuxDnsPathObservation,
} from "./linux-dns-observation.js";
import {
  createLinuxCapabilityRegistry,
  LinuxCapabilities,
  LinuxCapabilityStates,
} from "./linux-capabilities.js";

test("resolver configuration is parsed with IPv4/IPv6 evidence independently", () => {
  const result = parseLinuxResolvConf("nameserver 1.1.1.1\nnameserver 2606:4700:4700::1111\n");
  assert.equal(result.state, LinuxCapabilityStates.VERIFIED);
  assert.equal(result.evidence.ipv4NameserverCount, 1);
  assert.equal(result.evidence.ipv6NameserverCount, 1);
});

test("missing or invalid resolver evidence fails closed", () => {
  assert.equal(parseLinuxResolvConf("").state, LinuxCapabilityStates.FAILED);
  assert.equal(parseLinuxResolvConf("nameserver not-an-ip").state, LinuxCapabilityStates.FAILED);
  assert.equal(observeLinuxDns({ readFile: () => { throw new Error("denied"); } }).state, LinuxCapabilityStates.FAILED);
});

test("resolver discovery is evidence only and never claims traffic-path security", () => {
  const observation = parseLinuxResolvConf("nameserver 1.1.1.1\n");
  const registry = createLinuxCapabilityRegistry();
  const synced = syncLinuxDnsObservation({ capabilityRegistry: registry, observation });
  assert.equal(synced.ok, true);
  assert.equal(synced.capability.capability, LinuxCapabilities.DNS_OBSERVATION);
  assert.equal(synced.capability.state, LinuxCapabilityStates.VERIFIED);
  assert.equal(synced.capability.evidence.trafficPathVerified, false);
  const evaluated = evaluateLinuxDnsPathObservation(synced.capability);
  assert.equal(evaluated.ready, false);
  assert.equal(evaluated.securityHealthy, false);
});

test("malformed observation cannot be upgraded", () => {
  const registry = createLinuxCapabilityRegistry();
  const result = syncLinuxDnsObservation({
    capabilityRegistry: registry,
    observation: { state: "bogus", reason: "bad", evidence: {} },
  });
  assert.equal(result.ok, true);
  assert.equal(result.capability.state, LinuxCapabilityStates.FAILED);
});
