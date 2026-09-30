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
import {
  LANDING_ENDPOINT_TYPES,
  createLandingEndpointCatalog,
  resolveLandingEndpoint,
} from "./landing-endpoints.js";

function canonicalServiceCatalog() {
  const global = {};
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) {
    const target = category === "meta_ai" ? "ai" : category;
    global[target] = [...(global[target] || []), ...services];
  }
  return Object.freeze(global);
}

export function resolvePlatformLandingDecision(plan, {
  preferredId = null,
  preferredType = null,
} = {}) {
  if (!plan || !Array.isArray(plan.landingEndpoints)) {
    return Object.freeze({
      target: Object.freeze({
        type: "reject",
        target: plan?.policy?.rejectTarget || "reject",
        reason: "no-landing-endpoints",
      }),
    });
  }

  try {
    const resolved = resolveLandingEndpoint(plan.landingEndpoints, {
      preferredId,
      preferredType,
    });
    return Object.freeze({
      target: Object.freeze({
        type: "landing",
        endpoint: resolved.selected,
        endpointId: resolved.selected.id,
        endpointType: resolved.selected.type,
        candidates: resolved.candidates,
      }),
    });
  } catch (error) {
    return Object.freeze({
      target: Object.freeze({
        type: "reject",
        target: plan.policy.rejectTarget || "reject",
        reason: "no-usable-landing-endpoint",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
}

export function resolvePlatformRoutingDecision(plan, context = {}, {
  health = {},
  preferredRegion = null,
  preferredLandingId = null,
  preferredLandingType = null,
} = {}) {
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

  const target = {
    type: "node",
    target: resolved.node,
    nodeId: String(resolved.node.id || resolved.node.uuid || resolved.node.name || resolved.node.server || ""),
    region: resolved.region,
    serviceKey: routing.serviceKey,
    selectionMode: resolved.selectionMode,
    candidates: resolved.candidates,
  };

  if (preferredLandingId || preferredLandingType) {
    const landing = resolvePlatformLandingDecision(plan, {
      preferredId: preferredLandingId,
      preferredType: preferredLandingType,
    });
    if (landing.target.type === "reject") {
      return Object.freeze({ evaluation, target: landing.target });
    }
    target.landing = landing.target;
  }

  return Object.freeze({
    evaluation,
    target: Object.freeze(target),
  });
}

export function createPlatformRoutingPlan({
  nodes = [],
  routingOptions = {},
  regionOptions = {},
  serviceDefaults = {},
  serviceOverrides = {},
  landingOptions = {},
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
  const landingEndpoints = createLandingEndpointCatalog({
    nodes,
    warp: Array.isArray(landingOptions.warp) ? landingOptions.warp : [],
  });

  return Object.freeze({
    version: 3,
    policy,
    regionGroups,
    serviceBindings,
    serviceCatalog: Object.freeze(serviceCatalog),
    landingEndpoints,
    routingOptions: createRoutingPolicyOptions(routingOptions),
    landingOptions: Object.freeze({
      preferredType: landingOptions.preferredType || null,
    }),
  });
}
