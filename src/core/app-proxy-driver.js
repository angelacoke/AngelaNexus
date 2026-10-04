import { createApplicationIdentity, matchesApplicationIdentity } from "./application-identity.js";

export const AppProxyDriverCapabilities = Object.freeze({
  APPLICATION_SCOPE: "application-scope",
  PROCESS_SCOPE: "process-scope",
  ENVIRONMENT_PROXY: "environment-proxy",
  HTTP_PROXY: "http-proxy",
  HTTPS_PROXY: "https-proxy",
  SOCKS_PROXY: "socks-proxy",
  NO_PROXY: "no-proxy",
  LAUNCH_CHILD: "launch-child",
  EGRESS_VERIFY: "egress-verify",
});

export const AppProxyDriverStates = Object.freeze([
  "ready",
  "active",
  "degraded",
  "unavailable",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCapabilities(value) {
  return Object.freeze([...new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [])]);
}

/**
 * Platform-neutral contract for application-scoped proxy execution.
 *
 * The driver does not decide routing policy and does not select a kernel.
 * It only translates an already-authorized execution plan into a platform
 * mechanism such as environment variables, native per-app proxy APIs, or
 * another platform-specific process/connection adapter.
 */
export function createAppProxyDriver(implementation = {}) {
  if (!implementation || typeof implementation !== "object") {
    throw new TypeError("application proxy driver is required");
  }

  const id = text(implementation.id);
  if (!id) throw new TypeError("application proxy driver id is required");
  if (typeof implementation.canExecute !== "function") {
    throw new TypeError("application proxy driver canExecute must be a function");
  }
  if (typeof implementation.execute !== "function") {
    throw new TypeError("application proxy driver execute must be a function");
  }

  return Object.freeze({
    ...implementation,
    id,
    type: "application-proxy",
    capabilities: normalizeCapabilities(implementation.capabilities),
    health: Object.freeze({
      state: AppProxyDriverStates.includes(text(implementation?.health?.state))
        ? text(implementation.health.state)
        : "unavailable",
      reason: text(implementation?.health?.reason) || null,
    }),
  });
}

export function canAppProxyDriverMatch(driver, plan = {}) {
  if (!driver || typeof driver !== "object") return false;
  const identity = plan.application?.identity;
  const selector = plan.application?.selector;
  if (!identity || !selector) return false;

  try {
    const normalizedIdentity = createApplicationIdentity(identity);
    if (!matchesApplicationIdentity(normalizedIdentity, selector)) return false;
    return typeof driver.canExecute === "function" && driver.canExecute(plan) === true;
  } catch {
    return false;
  }
}

export function createAppProxyExecutionPlan({
  application,
  proxy,
  route,
  userAuthorized = false,
  kernel = null,
  decisionId = null,
} = {}) {
  if (!application?.identity) throw new Error("application proxy plan requires application identity");
  if (!application?.selector) throw new Error("application proxy plan requires application selector");
  if (!proxy || typeof proxy !== "object") throw new Error("application proxy plan requires proxy endpoint");
  if (!route || typeof route !== "object") throw new Error("application proxy plan requires route");
  if (userAuthorized !== true) throw new Error("application proxy plan requires explicit user authorization");

  const identity = createApplicationIdentity(application.identity);
  const selector = Object.freeze({
    ...application.selector,
  });

  return Object.freeze({
    kind: "application-proxy-plan",
    version: 1,
    scope: Object.freeze({
      type: application.scope === "process" ? "process" : "application",
      identity,
      selector,
    }),
    proxy: Object.freeze({
      type: text(proxy.type).toLowerCase() || "socks",
      host: text(proxy.host),
      port: Number(proxy.port),
    }),
    route: Object.freeze({ ...route }),
    kernel: kernel || null,
    decisionId: decisionId || null,
    userAuthorized: true,
  });
}
