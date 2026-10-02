import { createRuleSourceUpdateManager } from "./rule-source-update-manager.js";
import { createResourcePolicy } from "./resource-policy.js";

export const RULE_SOURCE_REFRESH_VERSION = 1;

export const RuleSourceRefreshStates = Object.freeze({
  IDLE: "idle",
  UPDATING: "updating",
  ACTIVE: "active",
  REJECTED: "rejected"
});

function freeze(value) {
  return Object.freeze(value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item]))
    : value);
}

export function createRuleSourceRefreshService({
  trustPolicy = {},
  semanticValidator,
  initial = null,
  resourcePolicy = {},
  now = Date.now
} = {}) {
  const refreshPolicy = createResourcePolicy(resourcePolicy);
  const manager = createRuleSourceUpdateManager({
    trustPolicy,
    semanticValidator,
    initial,
    now
  });

  let state = initial ? RuleSourceRefreshStates.ACTIVE : RuleSourceRefreshStates.IDLE;
  let lastResult = null;
  let inFlight = null;

  function snapshot() {
    const active = manager.getActive();
    return freeze({
      version: RULE_SOURCE_REFRESH_VERSION,
      state,
      policy: refreshPolicy,
      active: active ? {
        metadata: { ...active.metadata },
        bytes: active.content.length
      } : null,
      lastResult
    });
  }

  async function refresh(fetchCandidate) {
    if (inFlight) return inFlight;

    state = RuleSourceRefreshStates.UPDATING;
    inFlight = (async () => {
      const result = await manager.update(fetchCandidate);
      lastResult = result;
      state = result.ok
        ? RuleSourceRefreshStates.ACTIVE
        : RuleSourceRefreshStates.REJECTED;
      return freeze({
        ...result,
        snapshot: snapshot()
      });
    })();

    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return Object.freeze({
    version: RULE_SOURCE_REFRESH_VERSION,
    policy: refreshPolicy,
    refresh,
    getActive: () => manager.getActive(),
    getStaged: () => manager.getStaged(),
    snapshot
  });
}
