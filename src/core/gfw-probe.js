import { GfwSignals } from "./gfw-policy.js";
import { ProbeScheduler } from "./probe.js";
import { createResourcePolicy } from "./resource-policy.js";

const RESULT_SIGNAL_MAP = Object.freeze({
  dnsInjection: GfwSignals.DNS_INJECTION,
  poisonedDnsDestination: GfwSignals.POISONED_DNS_DESTINATION,
  tcpReset: GfwSignals.TCP_RESET,
  tlsSniFailure: GfwSignals.TLS_SNI_FAILURE,
  quicInitialFailure: GfwSignals.QUIC_INITIAL_FAILURE,
  activeProbeSuspected: GfwSignals.ACTIVE_PROBE_SUSPECTED,
  residualBlocking: GfwSignals.RESIDUAL_BLOCKING,
  regionalVariance: GfwSignals.REGIONAL_VARIANCE,
  certificateAnomaly: GfwSignals.CERTIFICATE_ANOMALY,
  bootstrapIntegrityFailure: GfwSignals.BOOTSTRAP_INTEGRITY_FAILURE,
  clockAnomaly: GfwSignals.CLOCK_ANOMALY,
  unexpectedRouteChange: GfwSignals.UNEXPECTED_ROUTE_CHANGE
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstSignal(result) {
  for (const [key, signal] of Object.entries(RESULT_SIGNAL_MAP)) {
    if (result && result[key] === true) return signal;
  }
  return null;
}

function normalizeResult(result = {}) {
  const signal = text(result.signal) || firstSignal(result);
  return Object.freeze({
    ok: result.ok === true,
    signal,
    independent: result.independent !== false,
    transport: text(result.transport) || null,
    destination: text(result.destination) || null,
    count: Number.isInteger(result.count) && result.count > 0 ? result.count : 1
  });
}

/**
 * Kernel-neutral GFW probe coordinator.
 *
 * It schedules only the caller-supplied probe operation. It does not choose
 * routes, bypass controls, transports, or destinations. Active probing is
 * opt-in and additionally requires explicit user choice.
 */
export function createGfwProbeCoordinator({
  gfwRuntime,
  resourcePolicy = {},
  resourceState = {},
  enabled = true,
  activeProbeEnabled = false
} = {}) {
  if (!gfwRuntime || typeof gfwRuntime.observe !== "function") {
    throw new TypeError("GFW runtime with observe is required");
  }

  const policy = createResourcePolicy(resourcePolicy);
  const scheduler = new ProbeScheduler({
    enabled,
    resourcePolicy: policy,
    resourceState
  });

  async function run(probe, { active = false, userChoice = false, now = Date.now() } = {}) {
    if (typeof probe !== "function") throw new TypeError("GFW probe must be a function");
    if (active && (!activeProbeEnabled || userChoice !== true)) {
      return Object.freeze({
        status: "blocked",
        reason: "active GFW probing requires explicit user choice"
      });
    }

    const result = normalizeResult(await probe({ active }));
    if (!result.signal) {
      return Object.freeze({
        status: result.ok ? "clear" : "no-evidence",
        result
      });
    }

    const evidence = gfwRuntime.observe({
      signal: result.signal,
      independent: result.independent,
      transport: result.transport,
      destination: result.destination,
      count: result.count
    }, now);

    return Object.freeze({
      status: "observed",
      result,
      evidence
    });
  }

  return Object.freeze({
    policy,
    scheduler,
    run,
    start(probe, options = {}) {
      if (typeof probe !== "function") throw new TypeError("GFW probe must be a function");
      scheduler.start(() => { void run(probe, options); });
      return scheduler.getIntervalMs();
    },
    updateResourceState(state = {}) {
      return scheduler.updateResourceState(state);
    },
    stop() {
      scheduler.stop();
    },
    getIntervalMs() {
      return scheduler.getIntervalMs();
    }
  });
}
