import { adapterFor } from "../adapters/index.js";
import { AdapterCapabilities, hasAdapterCapability } from "../adapters/contract.js";
import { compileGroups } from "./group-compiler.js";
import { resolveChain } from "./chain-resolution.js";
import { createProfileCustomization, resolveProfileChain } from "./profile-customization.js";
import { validateUnifiedCompatibility } from "./compatibility.js";
import { preflightUnifiedConfig } from "./compile-preflight.js";
import { validateCompiledConfig } from "./compiled-config-validation.js";

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function chainList(chains) {
  if (Array.isArray(chains)) return chains.filter((chain) => chain && chain.id);
  if (chains && typeof chains === "object") return Object.values(chains).filter((chain) => chain && chain.id);
  return [];
}
function chainHops(chain) {
  if (!chain || typeof chain !== "object") return [];
  if (Array.isArray(chain.hops)) return chain.hops;
  if (Array.isArray(chain.chain)) return chain.chain;
  if (chain.chain && typeof chain.chain === "object" && Array.isArray(chain.chain.hops)) return chain.chain.hops;
  return [];
}
function groupList(groups) {
  if (Array.isArray(groups)) return groups.filter((group) => group && group.id);
  if (groups && typeof groups === "object") return Object.values(groups).filter((group) => group && group.id);
  return [];
}
function profileFeatureState(config) {
  if (!config || typeof config !== "object") return undefined;
  if (config.profileFeatures && typeof config.profileFeatures === "object") return config.profileFeatures;
  if (config.profile && typeof config.profile === "object" && config.profile.features && typeof config.profile.features === "object") {
    return config.profile.features;
  }
  return undefined;
}
function groupIdsUsedByChains(chains, groups) {
  const byId = new Map(groupList(groups).map((group) => [String(group.id).trim(), group]));
  const ids = new Set();
  function visitGroup(id) {
    const normalized = String(id || "").trim();
    if (!normalized || ids.has(normalized)) return;
    const group = byId.get(normalized);
    if (!group) return;
    ids.add(normalized);
    for (const member of Array.isArray(group.members) ? group.members : []) {
      const memberId = String(member || "").trim();
      if (byId.has(memberId)) visitGroup(memberId);
    }
  }
  function visitHops(hops) {
    for (const hop of Array.isArray(hops) ? hops : []) {
      if (!hop || typeof hop !== "object") continue;
      const groupId = String(hop.group || hop.groupId || "").trim();
      if (groupId) visitGroup(groupId);
      if (Array.isArray(hop.chain)) visitHops(hop.chain);
      else if (hop.chain && typeof hop.chain === "object" && Array.isArray(hop.chain.hops)) visitHops(hop.chain.hops);
    }
  }
  for (const chain of chainList(chains)) visitHops(chainHops(chain));
  return ids;
}
function groupIdsUsedByRouting(routing, groups) {
  const byId = new Map(groupList(groups).map((group) => [String(group.id).trim(), group]));
  const ids = new Set();
  function visit(id) {
    const normalized = String(id || "").trim();
    if (!normalized || ids.has(normalized)) return;
    const group = byId.get(normalized);
    if (!group) return;
    ids.add(normalized);
    for (const member of Array.isArray(group.members) ? group.members : []) {
      const memberId = String(member || "").trim();
      if (byId.has(memberId)) visit(memberId);
    }
  }
  function collect(action) {
    if (action && typeof action === "object" && action.type === "route") visit(action.target);
  }
  for (const rule of routing && Array.isArray(routing.rules) ? routing.rules : []) collect(rule && rule.action);
  collect(routing && routing.defaultAction);
  return ids;
}
function groupsForKernel(config) {
  const definitions = groupList(config.groups);
  const chainGroups = groupIdsUsedByChains(config.chains, definitions);
  const routedGroups = groupIdsUsedByRouting(config.routing, definitions);
  const requiredByRouting = new Set(routedGroups);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of definitions) {
      const id = String(group.id).trim();
      if (!requiredByRouting.has(id)) continue;
      for (const member of Array.isArray(group.members) ? group.members : []) {
        const memberId = String(member || "").trim();
        if (!memberId || !definitions.some((candidate) => String(candidate.id).trim() === memberId)) continue;
        if (!requiredByRouting.has(memberId)) {
          requiredByRouting.add(memberId);
          changed = true;
        }
      }
    }
  }
  return definitions.filter((group) => !chainGroups.has(String(group.id).trim()) || requiredByRouting.has(String(group.id).trim()));
}
function chainMode(chain) { return typeof chain?.mode === "string" && chain.mode.trim() ? chain.mode : "node->node"; }
function resolveConfiguredChains(config, featureState, inactiveGroupIds = []) {
  const resolved = new Map();
  const inactiveChains = new Set();
  const disabledGroups = new Set((Array.isArray(inactiveGroupIds) ? inactiveGroupIds : []).map((id) => String(id).trim()).filter(Boolean));
  const profileGroups = featureState
    ? resolveProfileGroups(groupList(config.groups), featureState).map((group) => (
      disabledGroups.has(String(group.id).trim()) ? { ...group, enabled: false } : group
    ))
    : groupList(config.groups);
  for (const chain of chainList(config.chains)) {
    if (featureState) {
      const selected = resolveProfileChain(chain, featureState);
      if (!selected) continue;
    }
    const id = String(chain.id).trim();
    const resolvedChain = resolveChain(chainHops(chain), {
      nodes: config.nodes,
      groups: profileGroups,
      states: config.states,
      maxDepth: chain.maxDepth,
    });
    if (!resolvedChain.ok) {
      if (disabledGroups.size && /chain group (?:is disabled|has no usable member|not found)/.test(resolvedChain.error || "")) {
        inactiveChains.add(id);
        continue;
      }
      throw new Error("chain " + id + " cannot be safely compiled: " + resolvedChain.error);
    }
    resolved.set(id, { id, mode: chainMode(chain), hops: resolvedChain.data.hops.map((node) => clone(node)) });
  }
  return { resolved, inactive: [...inactiveChains] };
}
function nodeTargetMap(config) {
  const map = new Map();
  for (const node of Array.isArray(config.nodes) ? config.nodes : []) {
    if (!node || !node.id) continue;
    map.set(String(node.id).trim(), String(node.name || node.id).trim());
  }
  return map;
}
function rewriteAction(action, chains, groups, nodes) {
  if (!action || typeof action !== "object") return action;
  if (action.type === "chain") {
    const target = String(action.target || "").trim();
    const chain = chains.get(target);
    if (!chain) throw new Error("routing references missing chain: " + target);
    const finalHop = chain.hops[chain.hops.length - 1];
    if (!finalHop?.id) throw new Error("routing chain has no final hop: " + target);
    return { ...clone(action), type: "route", target: nodes.get(finalHop.id) || finalHop.id };
  }
  if (action.type === "route") {
    const target = String(action.target || "").trim();
    if (!target) throw new Error("routing route action requires target");
    const resolved = groups.targetMap.get(target) || nodes.get(target);
    if (!resolved) {
      if (groups.inactive instanceof Set && groups.inactive.has(target)) return null;
      throw new Error("routing references missing node or group: " + target);
    }
    return { ...clone(action), target: resolved };
  }
  return clone(action);
}
function routingForKernel(routing, chains, inactiveChains, groups, nodes, featureState) {
  const source = clone(routing || {});
  if (!source || typeof source !== "object") return source;
  const chainEnabled = Boolean(featureState && featureState.chainEnabled);
  const selectedChainId = featureState && typeof featureState.chainId === "string" ? featureState.chainId.trim() : "";
  const rewrite = (action) => {
    if (!action || typeof action !== "object") return action;
    if (action.type !== "chain") return rewriteAction(action, chains, groups, nodes);
    const target = String(action.target || "").trim();
    if (!chains.has(target)) {
      if (inactiveChains.has(target)) return null;
      if (featureState && (!chainEnabled || (selectedChainId && target !== selectedChainId))) return null;
      return rewriteAction(action, chains, groups, nodes);
    }
    return rewriteAction(action, chains, groups, nodes);
  };
  if (Array.isArray(source.rules)) {
    source.rules = source.rules
      .map((rule) => {
        if (!rule || !rule.action) return rule;
        const action = rewrite(rule.action);
        if (action === null) return null;
        return { ...rule, action };
      })
      .filter(Boolean);
  }
  if (source.defaultAction) {
    const action = rewrite(source.defaultAction);
    if (action === null) delete source.defaultAction;
    else source.defaultAction = action;
  }
  return source;
}
function compileResolvedChains(adapter, compiled, chains) {
  let output = compiled;
  for (const chain of chains.values()) output = adapter.compileChain(output, chain);
  return output;
}
export function compileUnifiedConfig(config, kernel = config && config.kernel) {
  if (!config || typeof config !== "object") throw new TypeError("unified configuration is required");
  const adapter = adapterFor(kernel);
  if (!adapter) throw new Error("unsupported kernel: " + kernel);
  if (!hasAdapterCapability(adapter, AdapterCapabilities.CONFIG_COMPILE)) throw new Error("kernel does not implement config compilation: " + kernel);
  const preflight = preflightUnifiedConfig(config, kernel);
  if (!preflight.ok) {
    const detail = preflight.errors.map((item) => [item.code, item.message].filter(Boolean).join(": ")).filter(Boolean).join("; ");
    const error = new Error("configuration preflight failed for " + kernel + ": " + detail + "; not safely compilable");
    error.code = "NEXUS_PREFLIGHT_FAILED";
    error.diagnostics = preflight.diagnostics;
    error.preflight = preflight;
    throw error;
  }
  const compatibility = preflight.compatibility;
  const featureInput = profileFeatureState(config);
  const featureState = featureInput
    ? createProfileCustomization({
      groups: groupList(config.groups),
      chains: chainList(config.chains),
      ...featureInput,
    })
    : undefined;
  const compilableGroups = groupsForKernel(config);
  const compiledGroups = compileGroups(compilableGroups, kernel, config.nodes, config.states, featureState);
  const chainState = resolveConfiguredChains(config, featureState, compiledGroups.inactive);
  const resolvedChains = chainState.resolved;
  const inactiveChains = new Set(chainState.inactive);
  const nodeTargets = nodeTargetMap(config);
  const compiledGroupState = { ...compiledGroups, inactive: new Set(compiledGroups.inactive || []) };
  const kernelConfig = {
    ...config,
    security: preflight.security.policy,
    groups: compiledGroups.groups,
    routing: routingForKernel(config.routing, resolvedChains, inactiveChains, compiledGroupState, nodeTargets, featureState),
  };
  const compiledBase = adapter.compileConfig(kernelConfig);
  const compiled = resolvedChains.size ? compileResolvedChains(adapter, compiledBase, resolvedChains) : compiledBase;
  const validation = validateCompiledConfig(compiled, kernel);
  if (!validation.ok) throw new Error("compiled configuration failed structural validation for " + kernel + ": " + validation.errors.join("; "));
  return {
    kernel,
    status: "compiled",
    config: compiled,
    validation,
    compatibility,
    preflight,
    groups: [...compiledGroups.targetMap.entries()].map(([id, target]) => ({ id, target })),
    chains: [...resolvedChains.values()].map((chain) => ({ id: chain.id, mode: chain.mode, hops: chain.hops.map((node) => node.id) })),
    inactiveChains: [...inactiveChains],
    inactiveGroups: [...new Set(compiledGroups.inactive || [])],
    profileFeatures: featureState ? clone(featureState) : undefined,
  };
}
