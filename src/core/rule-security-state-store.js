import {
  restoreRuleVersionState,
  sealRuleVersionState,
  verifyRuleVersionStateEnvelope
} from "./rule-version-policy.js";

export const RULE_SECURITY_STATE_STORE_VERSION = 1;

export const RULE_SECURITY_STATE_CAPABILITIES = Object.freeze({
  SECURE_ANCHOR: "secure-anchor",
  INTEGRITY_ONLY: "integrity-only",
  UNAVAILABLE: "unavailable"
});

const CAPABILITIES = new Set(Object.values(RULE_SECURITY_STATE_CAPABILITIES));

function assertFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(name + " must be a function");
}

function assertCapability(capability) {
  if (!CAPABILITIES.has(capability)) {
    throw new TypeError("unsupported rule security state capability: " + capability);
  }
  return capability;
}

export function createRuleSecurityStateStore({
  capability,
  loadEnvelope,
  saveEnvelope,
  loadAnchor,
  saveAnchor
} = {}) {
  assertCapability(capability);
  assertFunction(loadEnvelope, "loadEnvelope");
  assertFunction(saveEnvelope, "saveEnvelope");

  if (capability === RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR) {
    assertFunction(loadAnchor, "loadAnchor");
    assertFunction(saveAnchor, "saveAnchor");
  }

  return Object.freeze({
    version: RULE_SECURITY_STATE_STORE_VERSION,
    capability,
    loadEnvelope,
    saveEnvelope,
    loadAnchor: loadAnchor || (async () => null),
    saveAnchor: saveAnchor || (async () => undefined)
  });
}

export async function inspectRuleSecurityStateStore(store) {
  if (!store || store.version !== RULE_SECURITY_STATE_STORE_VERSION) {
    throw new TypeError("invalid rule security state store");
  }
  return Object.freeze({
    version: store.version,
    capability: assertCapability(store.capability),
    secureAnchorAvailable:
      store.capability === RULE_SECURITY_STATE_CAPABILITIES.SECURE_ANCHOR
  });
}

export async function loadRuleSecurityState(store, {
  requireSecureAnchor = true
} = {}) {
  const info = await inspectRuleSecurityStateStore(store);
  const envelope = await store.loadEnvelope();

  if (!envelope) {
    return Object.freeze({
      available: false,
      capability: info.capability,
      state: null,
      verification: null,
      anchor: null
    });
  }

  let anchor = null;
  if (info.secureAnchorAvailable) {
    anchor = await store.loadAnchor();
    if (!anchor) {
      if (requireSecureAnchor) {
        const error = new Error("secure rule state anchor is unavailable");
        error.code = "NEXUS_RULE_SECURITY_ANCHOR_UNAVAILABLE";
        throw error;
      }
    }
  }

  const verification = await verifyRuleVersionStateEnvelope(envelope, { anchor });
  if (!verification.ok) {
    const error = new Error("rule security state rejected: " + verification.reason);
    error.code = "NEXUS_RULE_SECURITY_STATE_REJECTED";
    error.verification = verification;
    throw error;
  }

  const state = await restoreRuleVersionState(envelope, { anchor });
  return Object.freeze({
    available: true,
    capability: info.capability,
    state,
    verification,
    anchor
  });
}

export async function persistRuleSecurityState(store, state, {
  generation,
  requireSecureAnchor = true
} = {}) {
  const info = await inspectRuleSecurityStateStore(store);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("rule security state generation is invalid");
  }

  let anchor = null;
  if (info.secureAnchorAvailable) {
    anchor = await store.loadAnchor();
    if (!anchor) {
      if (requireSecureAnchor) {
        const error = new Error("secure rule state anchor is unavailable");
        error.code = "NEXUS_RULE_SECURITY_ANCHOR_UNAVAILABLE";
        throw error;
      }
    } else if (generation <= anchor.generation) {
      const error = new Error("rule security state generation is not monotonic");
      error.code = "NEXUS_RULE_SECURITY_STATE_ROLLBACK";
      throw error;
    }
  }

  const previousChecksum = anchor?.checksum || null;
  const envelope = await sealRuleVersionState(state, {
    generation,
    previousChecksum
  });

  const preflight = await verifyRuleVersionStateEnvelope(envelope, {
    anchor
  });
  if (!preflight.ok) {
    const error = new Error("rule security state preflight rejected: " + preflight.reason);
    error.code = "NEXUS_RULE_SECURITY_STATE_REJECTED";
    error.verification = preflight;
    throw error;
  }

  await store.saveEnvelope(envelope);

  if (info.secureAnchorAvailable && (anchor || requireSecureAnchor)) {
    await store.saveAnchor({
      generation: envelope.generation,
      checksum: envelope.checksum
    });
  }

  return Object.freeze({
    capability: info.capability,
    envelope,
    anchor: {
      generation: envelope.generation,
      checksum: envelope.checksum
    }
  });
}
