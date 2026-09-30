function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function positivePort(value, field) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new RangeError(field + " must be a valid TCP port");
  }
  return value;
}

function normalizeEndpoint(endpoint, field) {
  if (!endpoint || typeof endpoint !== "object") throw new TypeError(field + " is required");
  const host = text(endpoint.host);
  if (!host) throw new Error(field + ".host is required");
  return Object.freeze({
    host,
    port: positivePort(endpoint.port, field + ".port"),
  });
}

function normalizeHop(hop, index) {
  if (!hop || typeof hop !== "object") throw new TypeError("pipeline hop " + index + " is invalid");
  if (!hop.kernel || typeof hop.kernel !== "string") throw new Error("pipeline hop " + index + " requires a kernel");
  if (!hop.node) throw new Error("pipeline hop " + index + " requires a node profile");
  return Object.freeze({
    id: text(hop.id) || "hop-" + (index + 1),
    kernel: text(hop.kernel),
    node: hop.node,
    listen: normalizeEndpoint(hop.listen, "pipeline hop " + index + " listen"),
  });
}

export function createPipelineSpec({
  id,
  hops,
  inbound = null,
  security = {},
  resources = {},
} = {}) {
  const pipelineId = text(id);
  if (!pipelineId) throw new Error("pipeline id is required");
  if (!Array.isArray(hops) || hops.length === 0) throw new Error("pipeline requires at least one hop");

  const normalizedHops = hops.map(normalizeHop);
  const seen = new Set();
  for (const hop of normalizedHops) {
    if (seen.has(hop.id)) throw new Error("pipeline hop id is duplicated: " + hop.id);
    seen.add(hop.id);
  }

  return Object.freeze({
    version: 1,
    id: pipelineId,
    inbound: inbound ? normalizeEndpoint(inbound, "pipeline inbound") : null,
    hops: Object.freeze(normalizedHops),
    security: Object.freeze({
      failClosed: security.failClosed !== false,
      selfLoopProtection: security.selfLoopProtection !== false,
    }),
    resources: Object.freeze(structuredClone(resources || {})),
  });
}
