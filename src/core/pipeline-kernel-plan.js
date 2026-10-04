import { Kernels } from "./model.js";
import { createPipelineSpec } from "./pipeline.js";
import { createUnifiedKernelSelection } from "./unified-kernel-selection.js";

export const PIPELINE_KERNEL_PLAN_VERSION = 1;

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

function resolveNode(resolver, id, index) {
  if (typeof resolver === "function") return resolver(id, index);
  if (resolver && typeof resolver === "object") return resolver[id] || null;
  return null;
}

/**
 * Resolves every executable pipeline hop through the same deterministic
 * capability registry + driver scheduler used by single-node execution.
 * It never invents nodes, kernels, or failover paths.
 */
export function createKernelAwarePipelinePlan(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("pipeline kernel plan input is required");
  const spec = input.spec?.kind === "pipeline-spec" ? input.spec : createPipelineSpec(input.pipeline || input);
  const resolver = input.nodeResolver || input.nodes;
  if (spec.mode === "direct" || spec.mode === "reject") {
    return freeze({ kind: "pipeline-kernel-plan", version: PIPELINE_KERNEL_PLAN_VERSION, spec, ok: true, hops: [], reason: "pipeline mode does not require a kernel" });
  }

  const ids = spec.mode === "proxy" ? [spec.target] : spec.hops.map((hop) => hop.id);
  const hops = ids.map((id, index) => {
    const node = resolveNode(resolver, id, index);
    if (!node) return { id, index, ok: false, selection: null, reason: "pipeline node cannot be resolved" };
    const selection = createUnifiedKernelSelection(node, input);
    return {
      id,
      index,
      ok: selection.ok === true,
      kernel: selection.selected?.kernel || null,
      selection,
      reason: selection.reason,
    };
  });

  const failed = hops.filter((hop) => !hop.ok);
  if (failed.length) {
    return freeze({
      kind: "pipeline-kernel-plan",
      version: PIPELINE_KERNEL_PLAN_VERSION,
      spec,
      ok: false,
      hops,
      reason: "one or more pipeline hops cannot be assigned an executable kernel",
      failedHops: failed.map(({ id, index, reason }) => ({ id, index, reason })),
    });
  }

  return freeze({
    kind: "pipeline-kernel-plan",
    version: PIPELINE_KERNEL_PLAN_VERSION,
    spec,
    ok: true,
    hops,
    reason: "all pipeline hops have deterministic kernel selections",
  });
}

export function selectPipelineKernels(input = {}) {
  const plan = createKernelAwarePipelinePlan(input);
  return plan.ok ? plan.hops.map((hop) => hop.kernel) : [];
}

export { Kernels };
