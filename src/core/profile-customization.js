/**
 * User-controlled per-profile feature switches.
 *
 * This is an AngelaNexus platform model. It does not copy or depend on any
 * external application's implementation. A profile owns its switches so the
 * same imported configuration can be used with different user choices.
 */

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(clean)
    .filter((value) => value && !seen.has(value) && seen.add(value));
}

function normalizeBoolean(value, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export const DEFAULT_PROFILE_FEATURES = Object.freeze({
  enabledGroupIds: Object.freeze([]),
  disabledGroupIds: Object.freeze([]),
  chainEnabled: false,
  chainId: null,
});

export function createProfileFeatureState(input = {}) {
  if (!input || typeof input !== "object") {
    throw new TypeError("profile feature state must be an object");
  }

  const enabled = new Set(uniqueStrings(input.enabledGroupIds));
  const disabled = new Set(uniqueStrings(input.disabledGroupIds));

  for (const id of disabled) enabled.delete(id);

  const chainId = clean(input.chainId) || null;
  return Object.freeze({
    enabledGroupIds: Object.freeze([...enabled]),
    disabledGroupIds: Object.freeze([...disabled]),
    chainEnabled: normalizeBoolean(input.chainEnabled, false) && Boolean(chainId),
    chainId,
  });
}

export function resolveProfileGroups(groups, featureState = DEFAULT_PROFILE_FEATURES) {
  const state = createProfileFeatureState(featureState);
  const enabled = new Set(state.enabledGroupIds);
  const disabled = new Set(state.disabledGroupIds);

  return (Array.isArray(groups) ? groups : Object.values(groups || {}))
    .filter((group) => group && group.id)
    .map((group) => {
      const id = clean(group.id);
      if (disabled.has(id)) return { ...group, enabled: false };
      if (enabled.has(id)) return { ...group, enabled: true };
      return { ...group };
    });
}

export function resolveProfileChain(chain, featureState = DEFAULT_PROFILE_FEATURES) {
  const state = createProfileFeatureState(featureState);
  if (!state.chainEnabled) return null;
  if (!chain || typeof chain !== "object") {
    throw new Error("enabled chain requires a chain definition");
  }
  if (state.chainId && clean(chain.id) !== state.chainId) {
    throw new Error("selected chain is not the active profile chain");
  }
  return Object.freeze({ ...chain, enabled: true });
}

export function createProfileCustomization({
  groups = [],
  chains = [],
  enabledGroupIds = [],
  disabledGroupIds = [],
  chainEnabled = false,
  chainId = null,
} = {}) {
  const state = createProfileFeatureState({
    enabledGroupIds,
    disabledGroupIds,
    chainEnabled,
    chainId,
  });

  const availableGroups = (Array.isArray(groups) ? groups : []).filter((group) => group && group.id);
  const availableChains = (Array.isArray(chains) ? chains : []).filter((chain) => chain && chain.id);

  const groupIds = new Set(availableGroups.map((group) => clean(group.id)));
  const unknownGroups = [...new Set([...state.enabledGroupIds, ...state.disabledGroupIds])]
    .filter((id) => !groupIds.has(id));
  if (unknownGroups.length) {
    throw new Error("profile references unknown policy group: " + unknownGroups.join(", "));
  }

  if (state.chainEnabled && !availableChains.some((chain) => clean(chain.id) === state.chainId)) {
    throw new Error("profile references unknown chain: " + state.chainId);
  }

  return Object.freeze({
    ...state,
    availableGroupIds: Object.freeze([...groupIds]),
    availableChainIds: Object.freeze(availableChains.map((chain) => clean(chain.id))),
  });
}
