import { RUNTIME_KEYS } from "./semantic-localization.js";

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
  idle: RUNTIME_KEYS.idle,
  preparing: RUNTIME_KEYS.preparing,
  validating: RUNTIME_KEYS.validating,
  starting: RUNTIME_KEYS.starting,
  running: RUNTIME_KEYS.running,
  degraded: RUNTIME_KEYS.degraded,
  recovering: RUNTIME_KEYS.recovering,
  stopped: RUNTIME_KEYS.stopped,
  failed: RUNTIME_KEYS.failed
});

export function toUiRuntimeState(experienceState) {
  if (!Object.prototype.hasOwnProperty.call(UI_RUNTIME_LABEL_KEYS, experienceState)) {
    throw new Error("unsupported runtime state: " + experienceState);
  }

  const activeExecution =
    experienceState === UiRuntimeStates.RUNNING ||
    experienceState === UiRuntimeStates.DEGRADED;

  return Object.freeze({
    state: experienceState,
    labelKey: UI_RUNTIME_LABEL_KEYS[experienceState],
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
