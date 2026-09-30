import { aggregateChainHealth } from "./chain-health.js";

export function createChainTopology(spec, health = {}) {
  if (!spec || !Array.isArray(spec.hops)) throw new TypeError("chain topology requires a pipeline spec");
  const hopHealth = Object.freeze(spec.hops.map((hop) => Object.freeze({
    hopId: hop.id,
    kernel: hop.kernel,
    listen: hop.listen,
    state: health[hop.id]?.state || "unknown",
    latencyMs: Number.isFinite(health[hop.id]?.latencyMs) ? health[hop.id].latencyMs : null,
    success: health[hop.id]?.success === true,
  })));
  const aggregate = aggregateChainHealth(hopHealth);
  return Object.freeze({
    pipelineId: spec.id,
    direction: "left-to-right",
    hops: hopHealth,
    edges: Object.freeze(hopHealth.slice(0, -1).map((hop, i) => Object.freeze({
      from: hop.hopId, to: hopHealth[i + 1].hopId,
      state: hop.state === "down" || hopHealth[i + 1].state === "down" ? "down" : "up",
    }))),
    health: aggregate,
  });
}
