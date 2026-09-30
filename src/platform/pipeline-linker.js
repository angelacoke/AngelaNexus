function clone(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

const LINK_TRANSPORTS = Object.freeze(["tcp", "udp"]);

function endpointKey(endpoint) {
  return endpoint.host + ":" + endpoint.port;
}

function validateTransport(transport) {
  if (!LINK_TRANSPORTS.includes(transport)) {
    throw new Error("unsupported pipeline link transport: " + transport);
  }
  return transport;
}

function normalizeEndpoint(endpoint, field) {
  if (!endpoint || typeof endpoint !== "object") throw new TypeError(field + " is required");
  if (typeof endpoint.host !== "string" || !endpoint.host.trim()) {
    throw new Error(field + ".host is required");
  }
  if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    throw new RangeError(field + ".port is invalid");
  }
  return Object.freeze({ host: endpoint.host.trim(), port: endpoint.port });
}

export function createPipelineLinkPlan(spec, { transports = LINK_TRANSPORTS } = {}) {
  if (!spec || !Array.isArray(spec.hops) || spec.hops.length === 0) {
    throw new TypeError("pipeline link plan requires a pipeline spec");
  }

  const allowed = Object.freeze([...new Set(transports.map(validateTransport))]);
  const seenEndpoints = new Map();

  for (const hop of spec.hops) {
    const endpoint = normalizeEndpoint(hop.listen, "pipeline hop " + hop.id + " listen");
    const key = endpointKey(endpoint);
    if (seenEndpoints.has(key)) {
      throw new Error("pipeline listen endpoint is duplicated: " + key);
    }
    seenEndpoints.set(key, hop.id);
  }

  const links = [];
  for (let index = 1; index < spec.hops.length; index += 1) {
    const from = spec.hops[index - 1];
    const to = spec.hops[index];
    const upstream = normalizeEndpoint(from.listen, "pipeline hop " + from.id + " listen");
    if (endpointKey(upstream) === endpointKey(to.listen)) {
      throw new Error("pipeline link creates a self-loop at hop: " + to.id);
    }
    links.push(Object.freeze({
      id: from.id + "->" + to.id,
      fromHopId: from.id,
      toHopId: to.id,
      fromKernel: from.kernel,
      toKernel: to.kernel,
      upstream: Object.freeze(clone(upstream)),
      transports: allowed,
    }));
  }

  return Object.freeze({
    version: 1,
    pipelineId: spec.id,
    links: Object.freeze(links),
    firstHopId: spec.hops[0].id,
    lastHopId: spec.hops[spec.hops.length - 1].id,
  });
}

export const PIPELINE_LINK_TRANSPORTS = LINK_TRANSPORTS;
