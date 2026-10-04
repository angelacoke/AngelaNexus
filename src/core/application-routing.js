import { createApplicationIdentity, normalizeApplicationSelector } from "./application-identity.js";
import { createAppProxyExecutionPlan } from "./app-proxy-driver.js";
import { createDriverSelection } from "./driver-scheduler.js";
import { normalizeCapabilities } from "../adapters/capability-negotiation.js";

export const ApplicationRoutingModes = Object.freeze({
  APPLICATION: "application",
  PROCESS: "process",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Compiles an already-authorized application/process routing intent into a
 * scoped execution plan and selects only a driver capable of that exact scope.
 *
 * This deliberately does not select a kernel. Kernel selection remains the
 * transport/protocol concern of the execution backend.
 */
export function createApplicationRoutingPlan(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("application routing input is required");
  const scope = input.scope === ApplicationRoutingModes.PROCESS
    ? ApplicationRoutingModes.PROCESS
    : ApplicationRoutingModes.APPLICATION;

  const identity = createApplicationIdentity(input.identity);
  const selector = normalizeApplicationSelector(input.selector || identity);

  if (selector.platform && selector.platform !== identity.platform) {
    throw new Error("application routing selector platform does not match identity");
  }

  const plan = createAppProxyExecutionPlan({
    application: { scope, identity, selector },
    proxy: input.proxy,
    route: input.route,
    userAuthorized: input.userAuthorized === true,
    kernel: input.kernel || null,
    decisionId: input.decisionId || null,
  });

  const drivers = Array.isArray(input.drivers) ? input.drivers.filter(Boolean) : [];
  const requiredCapabilities = normalizeCapabilities([
    scope === ApplicationRoutingModes.PROCESS ? "process-scope" : "application-scope",
    ...(Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities : []),
  ]);

  const selection = createDriverSelection({
    plan,
    drivers,
    requiredCapabilities,
    fixedDriver: input.fixedDriver,
    allowedDrivers: input.allowedDrivers,
    preferredDrivers: input.preferredDrivers,
    allowFailover: input.allowFailover === true,
  });

  return Object.freeze({
    ok: selection.status === "selected",
    status: selection.status,
    plan,
    driverSelection: selection,
    driver: selection.selected?.id || null,
    explanation: selection.status === "selected"
      ? "The selected driver can execute the requested application/process scope without widening it."
      : selection.explanation,
  });
}

export function assertScopedExecution(plan) {
  if (!plan || plan.kind !== "application-proxy-plan") {
    throw new TypeError("scoped execution requires an application proxy plan");
  }
  const scope = plan.scope?.type;
  if (!Object.values(ApplicationRoutingModes).includes(scope)) {
    throw new Error("unsupported application routing scope");
  }
  if (plan.userAuthorized !== true) {
    throw new Error("scoped execution requires explicit user authorization");
  }
  if (!plan.scope.identity || !plan.scope.selector) {
    throw new Error("scoped execution requires application identity and selector");
  }
  return true;
}

export function describeApplicationRouting(plan) {
  assertScopedExecution(plan);
  const identity = plan.scope.identity;
  return Object.freeze({
    scope: plan.scope.type,
    platform: identity.platform,
    application: text(identity.packageName) || text(identity.bundleId) || text(identity.executable) || text(identity.processName) || null,
    process: text(identity.processName) || null,
    driver: plan.driver || null,
    kernel: plan.plan?.kernel || null,
  });
}
