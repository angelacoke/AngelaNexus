import test from "node:test";
import assert from "node:assert/strict";
import { LinuxCapabilityStates } from "./linux-capabilities.js";
import { createLinuxNativeDnsTrafficProbe } from "./linux-native-dns-probe.js";

test("native DNS traffic probe verifies observed UDP/53 traffic", () => {
  const probe = createLinuxNativeDnsTrafficProbe({
    commandPath: "/native/dns-probe",
    spawnSyncImpl: () => ({
      status: 0,
      stdout: "dns-udp-state=1 dns-udp-packets=2\n",
      stderr: "",
    }),
  });
  const result = probe.probe();
  assert.equal(result.state, LinuxCapabilityStates.VERIFIED);
  assert.equal(result.evidence.packetCount, 2);
  assert.equal(result.evidence.trafficPathVerified, true);
  assert.equal(result.evidence.port, 53);
});

test("native DNS traffic probe treats no observed traffic as non-verified", () => {
  const probe = createLinuxNativeDnsTrafficProbe({
    commandPath: "/native/dns-probe",
    spawnSyncImpl: () => ({
      status: 0,
      stdout: "dns-udp-state=0 dns-udp-packets=0\n",
      stderr: "",
    }),
  });
  const result = probe.probe();
  assert.equal(result.state, LinuxCapabilityStates.UNSUPPORTED);
  assert.equal(result.evidence.trafficPathVerified, false);
});

test("native DNS traffic probe fails closed on malformed output", () => {
  const probe = createLinuxNativeDnsTrafficProbe({
    commandPath: "/native/dns-probe",
    spawnSyncImpl: () => ({ status: 0, stdout: "dns-udp-state=1", stderr: "" }),
  });
  assert.equal(probe.probe().state, LinuxCapabilityStates.FAILED);
});

test("native DNS traffic probe caches one bounded observation", () => {
  let calls = 0;
  const probe = createLinuxNativeDnsTrafficProbe({
    commandPath: "/native/dns-probe",
    spawnSyncImpl: () => {
      calls++;
      return { status: 0, stdout: "dns-udp-state=1 dns-udp-packets=1\n", stderr: "" };
    },
  });
  probe.probe();
  probe.probe();
  assert.equal(calls, 1);
});

test("native DNS traffic probe fails closed on command timeout", () => {
  const probe = createLinuxNativeDnsTrafficProbe({
    commandPath: "/native/dns-probe",
    spawnSyncImpl: () => ({ status: null, signal: "SIGTERM", stdout: "", stderr: "" }),
  });
  assert.equal(probe.probe().reason, "dns-probe-timeout");
});
