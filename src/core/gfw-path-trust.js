import { createGfwRuntime, GfwStates } from "./gfw-policy.js";
import { createPathTrustSession } from "./path-trust.js";

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

  const unsubscribe = gfwRuntime.subscribeInvalidation((event = {}) => {
    const state = typeof event.state === "string" ? event.state : null;
    const signals = cloneSignals(event.signals);
    const actions = cloneSignals(event.actions);
    const eventReason = typeof event.reason === "string" ? event.reason.trim() : "";
    const reason = eventReason || [
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

  if (typeof gfwRuntime.snapshot === "function") {
    const current = gfwRuntime.snapshot();
    const actions = Array.isArray(current && current.actions) ? current.actions : [];
    if (actions.includes("require-path-revalidation") || actions.includes("revalidate-path")) {
      pathTrustSession.invalidate({
        reason: "gfw-path-revalidation-required",
        state: typeof current.state === "string" ? current.state : GfwStates.SUSPECTED,
        signals: cloneSignals(current.signals),
        actions: cloneSignals(current.actions),
        score: current.score,
        confidence: current.confidence
      });
    }
  }

  return unsubscribe;
}


/**
 * Canonical kernel-neutral GFW runtime assembly.
 *
 * Creates the bounded GFW evidence runtime and binds its invalidation
 * lifecycle to the supplied path-trust session. This keeps the security
 * integration explicit while preventing individual callers from forgetting
 * the GFW -> path-trust binding.
 */
export function createGfwPathTrustRuntime({ policy = {}, securityPolicy = null, pathTrustSession } = {}) {
  const session = pathTrustSession || createPathTrustSession();
  const systemGfwPolicy = securityPolicy && typeof securityPolicy === "object"
    ? securityPolicy.gfwResilience
    : null;
  const effectivePolicy = systemGfwPolicy && typeof systemGfwPolicy === "object"
    ? { ...systemGfwPolicy, ...policy }
    : policy;
  if (effectivePolicy.enabled === false || effectivePolicy.failClosed === false) {
    throw new Error("GFW path trust runtime requires enabled fail-closed resilience");
  }
  const gfw = createGfwRuntime(effectivePolicy);
  const unsubscribe = bindGfwPathTrust(gfw, session);

  return Object.freeze({
    gfw,
    pathTrust: session,
    unsubscribe
  });
}
