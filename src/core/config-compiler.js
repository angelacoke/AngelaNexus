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
  return definitions.filter((group) => !chainGroups.has(String(group.id).trim()) || routedGroups.has(String(group.id).trim()));
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
