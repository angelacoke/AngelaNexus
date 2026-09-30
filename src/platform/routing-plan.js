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
import { advisePlatformFailure } from "./recovery-advisor.js";

function canonicalServiceCatalog() {
  const global = {};
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) {
    const target = category === "meta_ai" ? "ai" : category;
    global[target] = [...(global[target] || []), ...services];
  }
  return Object.freeze(global);
}

function landingAlternatives(catalog, preferredId) {
  return (Array.isArray(catalog) ? catalog : [])
    .filter((endpoint) => endpoint && endpoint.enabled !== false && endpoint.id !== preferredId)
    .filter((endpoint) => endpoint.type !== LANDING_ENDPOINT_TYPES.WARP || Boolean(endpoint.credentialRef));
}

export function resolvePlatformLandingDecision(plan, {
  preferredId = null,
  preferredType = null,
} = {}) {
  if (!plan || !Array.isArray(plan.landingEndpoints)) {
    const advice = advisePlatformFailure({
      capability: "landing",
      reason: "no-landing-endpoints",
      impact: "required-landing-unavailable",
      details: "当前没有可用的落地出口。",
    });
    return Object.freeze({
      target: Object.freeze({
        type: "reject",
        target: plan?.policy?.rejectTarget || "reject",
        reason: "no-landing-endpoints",
        recovery: advice.recovery,
        notice: advice.notice,
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
    const isWarp = preferredType === LANDING_ENDPOINT_TYPES.WARP;
    const advice = advisePlatformFailure({
      capability: isWarp ? "warp" : "landing",
      reason: error instanceof Error ? error.message : String(error),
      impact: "required-landing-unavailable",
      details: isWarp
        ? "当前 WARP 落地不可用，请选择可用方案。"
        : "当前指定的落地出口不可用，请选择可用方案。",
      actions: isWarp
        ? ["regenerate", "switch-landing", "recheck", "reject"]
        : ["switch-landing", "recheck", "retry", "reject"],
      alternatives: landingAlternatives(plan.landingEndpoints, preferredId),
    });
    return Object.freeze({
      target: Object.freeze({
        type: "reject",
        target: plan.policy.rejectTarget || "reject",
        reason: "no-usable-landing-endpoint",
        error: error instanceof Error ? error.message : String(error),
        recovery: advice.recovery,
        notice: advice.notice,
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
    const advice = advisePlatformFailure({
      capability: "service-node",
      reason: error instanceof Error ? error.message : String(error),
      impact: "required-service-routing-unavailable",
      details: "当前服务没有可用的安全代理节点。",
      actions: ["recheck", "reject"],
    });
    return Object.freeze({
      evaluation,
      target: Object.freeze({
        type: "reject",
        target: plan.policy.rejectTarget || "reject",
        serviceKey: routing.serviceKey,
        reason: "no-usable-service-node",
        error: error instanceof Error ? error.message : String(error),
        recovery: advice.recovery,
        notice: advice.notice,
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
