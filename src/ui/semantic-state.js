export const UiRuntimeStates = Object.freeze({
  IDLE: "idle",
  PREPARING: "preparing",
  VALIDATING: "validating",
  STARTING: "starting",
  RUNNING: "running",
  DEGRADED: "degraded",
  RECOVERING: "recovering",
  STOPPED: "stopped",
  FAILED: "failed"
});

const labels = Object.freeze({
  idle: "idle",
  preparing: "preparing",
  validating: "validating",
  starting: "starting",
  running: "running",
  degraded: "degraded",
  recovering: "recovering",
  stopped: "stopped",
  failed: "failed"
});

export function toUiRuntimeState(experienceState) {
  if (!Object.prototype.hasOwnProperty.call(labels, experienceState)) {
    throw new Error("unsupported runtime state: " + experienceState);
  }

  const activeExecution =
    experienceState === UiRuntimeStates.RUNNING ||
    experienceState === UiRuntimeStates.DEGRADED;

  return Object.freeze({
    state: experienceState,
    label: labels[experienceState],
    activeExecution,
    proxyClaimAllowed: activeExecution
  });
}

export function createRuntimeViewModel({
  experienceState,
  vpnState = "unknown",
  routeState = "unknown",
  dnsState = "unknown",
  antiLeakState = "unknown",
  gfwState = "unknown",
  syncState = "unknown"
} = {}) {
  const runtime = toUiRuntimeState(experienceState);

  return Object.freeze({
    runtime,
    vpnState,
    routeState,
    dnsState,
    antiLeakState,
    gfwState,
    syncState
  });
}
