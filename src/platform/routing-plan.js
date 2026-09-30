import {
  GlobalServiceCatalog,
  DomesticServiceCatalog,
  createRoutingPolicyOptions,
  createSecureRoutingBaseline,
} from "./routing-strategy.js";
import {
  createRegionSelectionGroups,
  createServiceNodeBindings,
} from "./region-routing.js";

function canonicalServiceCatalog() {
  const global = {};
  for (const [category, services] of Object.entries(GlobalServiceCatalog)) {
    const target = category === "meta_ai" ? "ai" : category;
    global[target] = [...(global[target] || []), ...services];
  }
  return Object.freeze(global);
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
