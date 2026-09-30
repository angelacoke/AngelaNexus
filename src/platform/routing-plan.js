import {
  GlobalServiceCatalog,
  DomesticServiceCatalog,
  createRoutingPolicyOptions,
  createSecureRoutingBaseline,
  evaluateParallelRouting,
} from "./routing-strategy.js";
import {
  createRegionSelectionGroups,
  createServiceNodeBindings,
  resolveServiceNode,
} from "./region-routing.js";

function canonicalServiceCatalog() {
  const global = {};
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) {
    const target = category === "meta_ai" ? "ai" : category;
    global[target] = [...(global[target] || []), ...services];
  }
  return Object.freeze(global);
}

export function resolvePlatformRoutingDecision(plan, context = {}, { health = {}, preferredRegion = null } = {}) {
  if (!plan || !plan.policy) throw new Error("routing plan is required");
  const evaluation = evaluateParallelRouting(plan.policy, context);
  const selected = evaluation.selected;
  if (!selected) {
    return Object.freeze({
      evaluation,
      target: Object.freeze({ type: "route", target: plan.policy.defaultAction.target }),
    });
  }

  const routing = selected.routing;
  if (!routing || !routing.serviceKey) {
    return Object.freeze({ evaluation, target: selected.action });
  }

  if (selected.action?.type !== "route" || selected.action.target !== "secure-proxy") {
    return Object.freeze({ evaluation, target: selected.action });
  }

  const binding = plan.serviceBindings[routing.serviceKey];
  if (!binding) throw new Error("missing service routing binding: " + routing.serviceKey);
  let resolved;
  try {
    resolved = resolveServiceNode(routing.serviceKey, binding, plan.regionGroups, {
    health,
    preferredRegion,
  });

  } catch (error) {
    return Object.freeze({
      evaluation,
      target: Object.freeze({
        type: "reject",
        target: plan.policy.rejectTarget || "reject",
        serviceKey: routing.serviceKey,
        reason: "no-usable-service-node",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }

  return Object.freeze({
    evaluation,
    target: Object.freeze({
      type: "node",
      target: resolved.node,
      nodeId: String(resolved.node.id || resolved.node.uuid || resolved.node.name || resolved.node.server || ""),
      region: resolved.region,
      serviceKey: routing.serviceKey,
      selectionMode: resolved.selectionMode,
      candidates: resolved.candidates,
    }),
  });
}

export function createPlatformRoutingPlan({
  nodes = [],
  routingOptions = {},
  regionOptions = {},
  serviceDefaults = {},
  serviceOverrides = {},
} = {}) {
  const regionGroups = createRegionSelectionGroups(nodes, regionOptions);
  const serviceCatalog = {
    ...canonicalServiceCatalog(),
    domestic: DomesticServiceCatalog,
  };
  const serviceBindings = createServiceNodeBindings(serviceCatalog, regionGroups, {
    defaults: serviceDefaults,
    overrides: serviceOverrides,
  });
  const basePolicy = createSecureRoutingBaseline({ options: routingOptions });
  const rules = basePolicy.rules.map((rule) => {
    const binding = serviceBindings[rule.policyId];
    if (!binding) return rule;
    return Object.freeze({
      ...rule,
      routing: Object.freeze({
        serviceKey: binding.serviceKey,
        selection: binding.selection,
        availableRegions: binding.availableRegions,
      }),
    });
  });
  const policy = Object.freeze({
    ...basePolicy,
    rules: Object.freeze(rules),
  });

  return Object.freeze({
    version: 2,
    policy,
    regionGroups,
    serviceBindings,
    serviceCatalog: Object.freeze(serviceCatalog),
    routingOptions: createRoutingPolicyOptions(routingOptions),
  });
}
