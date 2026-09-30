export const ExperienceStates = Object.freeze({
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

const transitions = Object.freeze({
  [ExperienceStates.IDLE]: [ExperienceStates.PREPARING],
  [ExperienceStates.PREPARING]: [ExperienceStates.VALIDATING, ExperienceStates.FAILED],
  [ExperienceStates.VALIDATING]: [ExperienceStates.STARTING, ExperienceStates.FAILED],
  [ExperienceStates.STARTING]: [ExperienceStates.RUNNING, ExperienceStates.DEGRADED, ExperienceStates.FAILED],
  [ExperienceStates.RUNNING]: [ExperienceStates.DEGRADED, ExperienceStates.RECOVERING, ExperienceStates.STOPPED],
  [ExperienceStates.DEGRADED]: [ExperienceStates.RECOVERING, ExperienceStates.STOPPED, ExperienceStates.FAILED],
  [ExperienceStates.RECOVERING]: [ExperienceStates.RUNNING, ExperienceStates.DEGRADED, ExperienceStates.FAILED],
  [ExperienceStates.STOPPED]: [ExperienceStates.PREPARING],
  [ExperienceStates.FAILED]: [ExperienceStates.PREPARING, ExperienceStates.STOPPED]
});

function normalizeReason(reason) {
  if (reason === undefined || reason === null) return null;
  const value = String(reason).trim();
  return value ? value.slice(0, 512) : null;
}

function freezeSnapshot(state, reason, sequence) {
  return Object.freeze({
    state,
    reason,
    sequence
  });
}

export function canTransition(from, to) {
  return Array.isArray(transitions[from]) && transitions[from].includes(to);
}

export function createExperienceState(initialState = ExperienceStates.IDLE) {
  if (!Object.values(ExperienceStates).includes(initialState)) {
    throw new Error("unsupported experience state");
  }

  let state = initialState;
  let reason = null;
  let sequence = 0;
  const history = [];

  function snapshot() {
    return freezeSnapshot(state, reason, sequence);
  }

  function transition(nextState, nextReason) {
    if (!Object.values(ExperienceStates).includes(nextState)) {
      throw new Error("unsupported experience state");
    }
    if (!canTransition(state, nextState)) {
      throw new Error("invalid experience transition: " + state + " -> " + nextState);
    }

    state = nextState;
    reason = normalizeReason(nextReason);
    sequence += 1;
    history.push(snapshot());
    if (history.length > 32) history.shift();
    return snapshot();
  }

  return Object.freeze({
    get state() { return state; },
    snapshot,
    canTransition(nextState) { return canTransition(state, nextState); },
    transition,
    history() { return Object.freeze(history.slice()); }
  });
}
