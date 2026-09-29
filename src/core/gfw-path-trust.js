import { GfwStates } from "./gfw-policy.js";

function cloneSignals(value) {
  return Array.isArray(value) ? [...value] : [];
}

/**
 * Bridges GFW runtime evidence into the kernel-neutral path-trust lifecycle.
 *
 * GFW detection remains independent from path trust; this adapter only turns
 * a GFW revalidation event into an explicit path-trust invalidation so that
 * execution cannot continue on a path whose censorship/integrity state has
 * changed.
 */
export function bindGfwPathTrust(gfwRuntime, pathTrustSession) {
  if (!gfwRuntime || typeof gfwRuntime.subscribeInvalidation !== "function") {
    throw new TypeError("GFW runtime with subscribeInvalidation is required");
  }
  if (!pathTrustSession || typeof pathTrustSession.invalidate !== "function") {
    throw new TypeError("path trust session with invalidate is required");
  }

  return gfwRuntime.subscribeInvalidation((event = {}) => {
    const state = typeof event.state === "string" ? event.state : null;
    const signals = cloneSignals(event.signals);
    const actions = cloneSignals(event.actions);
    const reason = [
      "gfw",
      state || GfwStates.SUSPECTED,
      ...signals
    ].join(":");

    pathTrustSession.invalidate({ reason, state, signals, actions });

    return Object.freeze({
      reason,
      state,
      signals: Object.freeze(signals),
      actions: Object.freeze(actions)
    });
  });
}
