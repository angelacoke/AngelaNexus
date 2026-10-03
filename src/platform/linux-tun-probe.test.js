import test from "node:test";
import {
  evaluateLinuxTunProbe,
  probeLinuxTunCapability,
  LinuxTunStates,
} from "./linux-tun-probe.js";
import { LinuxCapabilities, LinuxCapabilityStates } from "./linux-capabilities.js";

test("TUN open failure is fail-closed", () => {
  const result = probeLinuxTunCapability({
    openTun: () => -1,
    probeTunState: () => ({ state: LinuxTunStates.RUNNING }),
  });

  assert.equal(result.capability, LinuxCapabilities.TUN);
  assert.equal(result.state, LinuxCapabilityStates.FAILED);
  assert.equal(result.reason, "tun-state-probe-failed");
});

test("successful kernel state query verifies TUN without claiming routing readiness", () => {
  const result = probeLinuxTunCapability({
    openTun: () => 7,
    probeTunState: () => ({
      state: LinuxTunStates.CREATED,
      evidence: { interface: "angelanexus0" },
    }),
    closeTun: () => {},
  });

  assert.equal(result.state, LinuxCapabilityStates.VERIFIED);
  assert.equal(result.evidence.tunState, LinuxTunStates.CREATED);
  assert.equal(result.evidence.interface, "angelanexus0");
  assert.equal(result.evidence.open, true);
});

test("invalid native state fails closed", () => {
  const result = evaluateLinuxTunProbe({ state: "not-a-state" });

  assert.equal(result.state, LinuxCapabilityStates.FAILED);
  assert.equal(result.reason, "tun-state-probe-failed");
});

test("probe closes a successfully opened handle", () => {
  const closed = [];
  probeLinuxTunCapability({
    openTun: () => 3,
    probeTunState: () => ({ state: LinuxTunStates.UP }),
    closeTun: (fd) => closed.push(fd),
  });

  assert.deepEqual(closed, [3]);
});
