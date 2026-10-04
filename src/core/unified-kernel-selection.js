import { Kernels, normalizeNode } from "./model.js";
import { createRuntimePlan } from "./runtime-plan.js";

export const UNIFIED_KERNEL_SELECTION_VERSION = 1;

const KERNEL_ORDER = Object.freeze([
  Kernels.MIHOMO,
  Kernels.SING_BOX,
  Kernels.XRAY,
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKernelList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

function scorePlan(result, kernel, options) {
  if (!result?.ok) return Number.NEGATIVE_INFINITY;

  const preferred = normalizeKernelList(options.preferredKernels);
  const preferredIndex = preferred.indexOf(kernel);
  const preferenceScore = preferredIndex >= 0 ? 100 - preferredIndex : 0;
  const nativeScore = result.plan?.runtime?.selectedMode === "native" ? 20 : 0;
  const explicitScore = options.kernel === kernel ? 1000 : 0;

  return explicitScore + preferenceScore + nativeScore;
}

export function createUnifiedKernelSelection(nodeInput, options = {}) {
  const node = normalizeNode(nodeInput);
  if (!node) {
    return Object.freeze({
      ok: false,
      status: "invalid-node",
      node: null,
      selected: null,
      candidates: Object.freeze([]),
      reason: "kernel selection requires a valid canonical node",
    });
  }

  const allowed = options.allowedKernels === undefined
    ? new Set(KERNEL_ORDER)
    : new Set(normalizeKernelList(options.allowedKernels));

  const fixed = text(options.kernel);
  if (fixed && !allowed.has(fixed)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      node,
      selected: null,
      candidates: Object.freeze([]),
      reason: "fixed kernel is outside the allowed kernel set",
    });
  }

  const kernels = fixed ? [fixed] : KERNEL_ORDER.filter((kernel) => allowed.has(kernel));
  const candidates = kernels.map((kernel) => {
    try {
      const result = createRuntimePlan(node, {
        ...options,
        kernel,
      });
      return Object.freeze({
        kernel,
        ok: result.ok === true,
        status: result.status,
        score: scorePlan(result, kernel, options),
        reason: result.reason || null,
        plan: result.ok ? result.plan : null,
        driverSelection: result.driverSelection || null,
      });
    } catch (error) {
      return Object.freeze({
        kernel,
        ok: false,
        status: "evaluation-error",
        score: Number.NEGATIVE_INFINITY,
        reason: error instanceof Error ? error.message : String(error),
        plan: null,
        driverSelection: null,
      });
    }
  });

  const eligible = candidates
    .filter((candidate) => candidate.ok)
    .sort((left, right) => right.score - left.score || KERNEL_ORDER.indexOf(left.kernel) - KERNEL_ORDER.indexOf(right.kernel));

  if (!eligible.length) {
    return Object.freeze({
      ok: false,
      status: fixed ? "rejected" : "unsupported",
      node,
      selected: null,
      candidates: Object.freeze(candidates),
      reason: fixed
        ? "fixed kernel cannot execute this node under the current capabilities and runtime policy"
        : "no kernel can execute this node under the current capabilities and runtime policy",
    });
  }

  const selected = eligible[0];
  return Object.freeze({
    ok: true,
    status: "ready",
    node,
    selected: Object.freeze({
      kernel: selected.kernel,
      score: selected.score,
      reason: selected.reason,
      runtime: selected.plan?.runtime || null,
      backend: selected.plan?.backend || null,
    }),
    candidates: Object.freeze(candidates),
    reason: fixed
      ? "fixed kernel satisfies the node execution requirements"
      : "best-fit kernel selected from the registered kernel capabilities and runtime policy",
  });
}

export function selectUnifiedKernel(nodeInput, options = {}) {
  return createUnifiedKernelSelection(nodeInput, options).selected?.kernel || null;
}
