import { HEALTH_STATES } from "../platform/chain-health.js";

const CONNECTION_STATES = Object.freeze({
  UP: "up",
  DOWN: "down",
  UNKNOWN: "unknown"
});

function stateOf(value) {
  return value === HEALTH_STATES.HEALTHY || value === HEALTH_STATES.DEGRADED
    ? CONNECTION_STATES.UP
    : value === HEALTH_STATES.DOWN
      ? CONNECTION_STATES.DOWN
      : CONNECTION_STATES.UNKNOWN;
}

export function createChainTopologyViewModel(topology) {
  if (!topology || !Array.isArray(topology.hops) || !Array.isArray(topology.edges)) {
    throw new TypeError("chain topology view requires a topology model");
  }

  const hops = Object.freeze(topology.hops.map((hop) => Object.freeze({
    id: hop.hopId,
    kernel: hop.kernel,
    listen: hop.listen,
    state: hop.state || HEALTH_STATES.UNKNOWN,
    connectionState: stateOf(hop.state),
    latencyMs: Number.isFinite(hop.latencyMs) ? hop.latencyMs : null,
    success: hop.success === true,
    bottleneck: topology.health && topology.health.bottleneckHopId === hop.hopId
  })));

  const edges = Object.freeze(topology.edges.map((edge) => Object.freeze({
    from: edge.from,
    to: edge.to,
    state: edge.state === "down" ? CONNECTION_STATES.DOWN : CONNECTION_STATES.UP
  })));

  return Object.freeze({
    pipelineId: topology.pipelineId,
    direction: topology.direction || "left-to-right",
    hops,
    edges,
    health: topology.health || Object.freeze({ state: HEALTH_STATES.UNKNOWN }),
    hasFailure: hops.some((hop) => hop.state === HEALTH_STATES.DOWN) ||
      edges.some((edge) => edge.state === CONNECTION_STATES.DOWN)
  });
}

export { CONNECTION_STATES };
