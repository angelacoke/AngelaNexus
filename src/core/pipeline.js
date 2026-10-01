export const PipelineModes = Object.freeze({
  DIRECT: "direct",
  PROXY: "proxy",
  CHAIN: "chain",
  REJECT: "reject",
});

export const PIPELINE_SPEC_VERSION = 1;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function freeze(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
}

function normalizeHop(hop, index) {
  if (typeof hop === "string") {
    const id = text(hop);
    return id ? { id, index } : null;
  }
  if (!hop || typeof hop !== "object") return null;
  const id = text(hop.id);
  if (!id) return null;
  return { id, index, role: text(hop.role) || null };
}

function validateMode(mode) {
  if (!Object.values(PipelineModes).includes(mode)) {
    throw new Error("unsupported pipeline mode: " + mode);
  }
}

export function createPipelineSpec(input = {}) {
  if (!input || typeof input !== "object") throw new TypeError("pipeline input is required");

  const mode = text(input.mode).toLowerCase();
  validateMode(mode);

  const rawHops = Array.isArray(input.hops) ? input.hops : [];
  const hops = rawHops.map(normalizeHop).filter(Boolean);
  if (rawHops.length !== hops.length) throw new Error("pipeline contains an invalid hop");

  const ids = new Set();
  for (const hop of hops) {
    if (ids.has(hop.id)) throw new Error("pipeline contains duplicate hop: " + hop.id);
    ids.add(hop.id);
  }

  const target = text(input.target) || null;

  if (mode === PipelineModes.PROXY && !target) {
    throw new Error("proxy pipeline target is required");
  }
  if (mode === PipelineModes.CHAIN && hops.length < 2) {
    throw new Error("chain pipeline requires at least two hops");
  }
  if (mode === PipelineModes.CHAIN && target) {
    throw new Error("chain pipeline cannot use a separate target");
  }
  if ((mode === PipelineModes.DIRECT || mode === PipelineModes.REJECT) && (target || hops.length)) {
    throw new Error(mode + " pipeline cannot contain a target or hops");
  }

  const spec = {
    kind: "pipeline-spec",
    version: PIPELINE_SPEC_VERSION,
    mode,
    target,
    hops,
    metadata: clone(input.metadata || {}),
  };

  return freeze(spec);
}

export function validatePipelineSpec(input = {}) {
  try {
    return Object.freeze({
      ok: true,
      spec: createPipelineSpec(input),
      errors: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      spec: null,
      errors: Object.freeze([error instanceof Error ? error.message : String(error)]),
    });
  }
}
