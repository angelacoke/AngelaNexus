import { createRoutingExecutionIntent, validateRoutingExecutionIntent } from "../core/routing-execution-intent.js";
import { toRoutingContext } from "../core/application-routing.js";

export const ANDROID_ROUTING_EXECUTION_VERSION = 1;

const MODES = Object.freeze(["system", "root"]);
const EXECUTION_MODES = Object.freeze(["proxy", "direct", "reject", "chain", "dns"]);

function text(value) { return typeof value === "string" ? value.trim() : ""; }
function list(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(text).filter(Boolean))];
}
function freezeObject(value) { return Object.freeze(value && typeof value === "object" ? structuredClone(value) : {}); }

/**
 * Kernel-neutral Android data-plane contract.
 *
 * Policy produces a Routing Execution Intent. This adapter translates that
 * intent into an Android VPN/TUN execution request without choosing Mihomo,
 * sing-box, or Xray and without invoking Android APIs directly.
 */
export function createAndroidRoutingExecution(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("android routing execution input is required");

  const routingIntent = input.intent
    ? input.intent
    : createRoutingExecutionIntent(input.routingDecision, {
        application: input.application,
        metadata: input.metadata,
      });
  const validation = validateRoutingExecutionIntent(routingIntent);
  if (!validation.ok) throw new Error("invalid routing execution intent: " + validation.errors.join("; "));

  const mode = text(input.transparentMode).toLowerCase() || "system";
  if (!MODES.includes(mode)) throw new Error("unsupported Android transparent mode: " + mode);

  const application = input.application || null;
  const routingContext = application
    ? toRoutingContext(application, {
        observedProcessName: input.observedProcessName,
        observedProcessPath: input.observedProcessPath,
        observedPackageName: input.observedPackageName,
      })
    : null;

  const execution = {
    version: ANDROID_ROUTING_EXECUTION_VERSION,
    kind: "android-routing-execution",
    platform: "android",
    transparentMode: mode,
    intent: routingIntent,
    executionMode: routingIntent.mode,
    target: routingIntent.target,
    hops: routingIntent.hops,
    application: application ? freezeObject(application) : null,
    routingContext,
    selectors: Object.freeze({
      packageNames: Object.freeze(list(routingContext?.package_name)),
      processNames: Object.freeze(list(routingContext?.process_name)),
      processPaths: Object.freeze(list(routingContext?.process_path)),
      executables: Object.freeze(list(routingContext?.executable)),
    }),
    controls: Object.freeze({
      userPolicy: "authoritative",
      kernelSelection: "deferred-to-capability-scheduler",
      hiddenFallback: false,
      failClosed: true,
    }),
  };

  if (!EXECUTION_MODES.includes(execution.executionMode)) {
    throw new Error("unsupported Android execution mode: " + execution.executionMode);
  }
  if (execution.executionMode === "chain" && execution.hops.length < 2) {
    throw new Error("Android chain execution requires at least two ordered hops");
  }
  if (["proxy", "direct", "dns"].includes(execution.executionMode) && !execution.target) {
    throw new Error("Android " + execution.executionMode + " execution requires a target");
  }

  return Object.freeze(execution);
}

export function validateAndroidRoutingExecution(input = {}) {
  try {
    const execution = createAndroidRoutingExecution(input);
    return Object.freeze({ ok: true, execution, errors: Object.freeze([]) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      execution: null,
      errors: Object.freeze([error instanceof Error ? error.message : String(error)]),
    });
  }
}
