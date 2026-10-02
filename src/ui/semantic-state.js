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

export const UI_RUNTIME_LABEL_KEYS = Object.freeze({
  idle: "runtime.idle",
  preparing: "runtime.preparing",
  validating: "runtime.validating",
  starting: "runtime.starting",
  running: "runtime.running",
  degraded: "runtime.degraded",
  recovering: "runtime.recovering",
  stopped: "runtime.stopped",
  failed: "runtime.failed"
});

export function toUiRuntimeState(experienceState) {
  if (!Object.prototype.hasOwnProperty.call(UI_RUNTIME_LABEL_KEYS, experienceState)) {
    throw new Error("unsupported runtime state: " + experienceState);
  }
  const activeExecution = experienceState === UiRuntimeStates.RUNNING || experienceState === UiRuntimeStates.DEGRADED;
  return Object.freeze({ state: experienceState, labelKey: UI_RUNTIME_LABEL_KEYS[experienceState], activeExecution, proxyClaimAllowed: activeExecution });
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
  return Object.freeze({ runtime, vpnState, routeState, dnsState, antiLeakState, gfwState, syncState });
}
