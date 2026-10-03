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

  expect(result.capability).toBe(LinuxCapabilities.TUN);
  expect(result.state).toBe(LinuxCapabilityStates.FAILED);
  expect(result.reason).toBe("tun-state-probe-failed");
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

  expect(result.state).toBe(LinuxCapabilityStates.VERIFIED);
  expect(result.evidence.tunState).toBe(LinuxTunStates.CREATED);
  expect(result.evidence.interface).toBe("angelanexus0");
  expect(result.evidence.open).toBe(true);
});

test("invalid native state fails closed", () => {
  const result = evaluateLinuxTunProbe({ state: "not-a-state" });

  expect(result.state).toBe(LinuxCapabilityStates.FAILED);
  expect(result.reason).toBe("tun-state-probe-failed");
});

test("probe closes a successfully opened handle", () => {
  const closed = [];
  probeLinuxTunCapability({
    openTun: () => 3,
    probeTunState: () => ({ state: LinuxTunStates.UP }),
    closeTun: (fd) => closed.push(fd),
  });

  expect(closed).toEqual([3]);
});
