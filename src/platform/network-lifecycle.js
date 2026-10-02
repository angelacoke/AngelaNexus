/**
 * AngelaNexus Network Lifecycle State Machine
 *
 * Owns platform-neutral gateway/runtime lifecycle. It never performs network
 * operations itself; adapters execute transitions and the acceptance harness
 * verifies the resulting live state.
 */

export const NETWORK_LIFECYCLE_STATES = Object.freeze([
  "stopped",
  "preparing",
  "applying",
  "running",
  "degraded",
  "recovering",
  "restored",
]);

const TRANSITIONS = Object.freeze({
  stopped: ["preparing"],
  preparing: ["applying", "stopped", "recovering"],
  applying: ["running", "degraded", "recovering"],
  running: ["degraded", "recovering", "stopped"],
  degraded: ["recovering", "stopped"],
  recovering: ["restored", "stopped"],
  restored: ["stopped", "preparing"],
});

export class NetworkLifecycle {
  constructor({ initialState = "stopped", evidenceStore, clock = () => new Date() } = {}) {
    if (!NETWORK_LIFECYCLE_STATES.includes(initialState)) throw new TypeError("invalid initialState");
    if (typeof evidenceStore?.record !== "function") throw new TypeError("evidenceStore.record must be a function");
    this.state = initialState;
    this.evidenceStore = evidenceStore;
    this.clock = clock;
    this.sequence = 0;
  }

  canTransition(to) {
    return TRANSITIONS[this.state]?.includes(to) === true;
  }

  async transition(to, { reason = "unspecified", scenarioId = null, decisionId = null, verified = true } = {}) {
    if (!NETWORK_LIFECYCLE_STATES.includes(to)) throw new TypeError("invalid target state");
    const from = this.state;
    if (!this.canTransition(to)) {
      const error = new Error(`invalid network lifecycle transition: ${from} -> ${to}`);
      error.failureClass = "verification-failed";
      throw error;
    }

    this.state = to;
    this.sequence += 1;
    const evidence = {
      lifecycleSequence: this.sequence,
      from,
      to,
      reason,
      scenarioId,
      decisionId,
      verified,
      timestamp: this.clock().toISOString(),
      evidenceSource: "network-lifecycle",
    };
    await this.evidenceStore.record(evidence);
    return evidence;
  }

  async recover({ reason = "recovery-requested", scenarioId = null, decisionId = null } = {}) {
    const started = await this.transition("recovering", { reason, scenarioId, decisionId, verified: false });
    return { started, state: this.state };
  }

  async restore({ reason = "cleanup-verified", scenarioId = null, decisionId = null } = {}) {
    if (this.state !== "recovering") throw new Error("restore requires recovering state");
    return this.transition("restored", { reason, scenarioId, decisionId, verified: true });
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      sequence: this.sequence,
    });
  }
}

export const NETWORK_LIFECYCLE_TRANSITIONS = TRANSITIONS;
