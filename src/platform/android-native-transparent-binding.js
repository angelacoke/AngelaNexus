import { ANDROID_TRANSPARENT_MODES, inspectAndroidTransparentCapabilities, selectAndroidTransparentMode } from "./android-transparent-adapter.js";

export const ANDROID_NATIVE_TRANSPARENT_BINDING_VERSION = 2;

const LIFECYCLE_STATES = Object.freeze({
  IDLE: "idle",
  PREPARED: "prepared",
  ACTIVE: "active",
  ROLLED_BACK: "rolled-back",
});

function requireFunction(value, name) {
  if (typeof value?.[name] !== "function") {
    throw new TypeError("android native transparent binding requires " + name);
  }
}

function optionalFunction(value, name) {
  return typeof value?.[name] === "function" ? value[name] : null;
}

export function createAndroidNativeTransparentBinding({
  runtime = {},
  probePath,
  prepareTransparent = null,
  applyTransparent = null,
  verifyTransparent = null,
  rollbackTransparent = null,
  requestedMode = ANDROID_TRANSPARENT_MODES.AUTO,
} = {}) {
  requireFunction({ probePath }, "probePath");

  const capabilities = inspectAndroidTransparentCapabilities(runtime);
  const selection = selectAndroidTransparentMode(requestedMode, capabilities);
  const supported = selection.selected !== "unavailable";
  const lifecycle = {
    prepare: optionalFunction({ prepareTransparent }, "prepareTransparent"),
    apply: optionalFunction({ applyTransparent }, "applyTransparent"),
    verify: optionalFunction({ verifyTransparent }, "verifyTransparent"),
    rollback: optionalFunction({ rollbackTransparent }, "rollbackTransparent"),
  };

  let state = LIFECYCLE_STATES.IDLE;

  function context(extra = {}) {
    return Object.freeze({
      ...extra,
      mode: selection.selected,
      backend: selection.backend?.id || "android-system-vpn",
      capabilities: Object.freeze({ ...capabilities }),
    });
  }

  async function prepare() {
    if (!supported) return Object.freeze({ ok: false, state, reason: "transparent-mode-unavailable" });
    if (state !== LIFECYCLE_STATES.IDLE) {
      return Object.freeze({ ok: false, state, reason: "invalid-lifecycle-state" });
    }
    if (!lifecycle.prepare) {
      state = LIFECYCLE_STATES.PREPARED;
      return Object.freeze({ ok: true, state, reason: "prepare-not-required" });
    }
    try {
      await lifecycle.prepare(context());
      state = LIFECYCLE_STATES.PREPARED;
      return Object.freeze({ ok: true, state, reason: "prepared" });
    } catch {
      state = LIFECYCLE_STATES.IDLE;
      return Object.freeze({ ok: false, state, reason: "prepare-failed" });
    }
  }

  async function apply() {
    if (!supported) return Object.freeze({ ok: false, state, reason: "transparent-mode-unavailable" });
    if (state !== LIFECYCLE_STATES.PREPARED) {
      return Object.freeze({ ok: false, state, reason: "not-prepared" });
    }
    try {
      if (lifecycle.apply) await lifecycle.apply(context());
      state = LIFECYCLE_STATES.ACTIVE;
      return Object.freeze({ ok: true, state, reason: "applied" });
    } catch {
      if (lifecycle.rollback) {
        try { await lifecycle.rollback(context({ reason: "apply-failed" })); } catch {}
      }
      state = LIFECYCLE_STATES.ROLLED_BACK;
      return Object.freeze({ ok: false, state, reason: "apply-failed" });
    }
  }

  async function verify() {
    if (!supported) return Object.freeze({ ok: false, state, reason: "transparent-mode-unavailable" });
    if (state !== LIFECYCLE_STATES.ACTIVE) {
      return Object.freeze({ ok: false, state, reason: "not-active" });
    }
    if (!lifecycle.verify) {
      return Object.freeze({ ok: false, state, reason: "verification-unavailable" });
    }
    try {
      const result = await lifecycle.verify(context());
      if (result === true || result?.ok === true) {
        return Object.freeze({ ok: true, state, reason: "verified" });
      }
      if (lifecycle.rollback) {
        try { await lifecycle.rollback(context({ reason: "verification-failed" })); } catch {}
      }
      state = LIFECYCLE_STATES.ROLLED_BACK;
      return Object.freeze({ ok: false, state, reason: "verification-failed" });
    } catch {
      if (lifecycle.rollback) {
        try { await lifecycle.rollback(context({ reason: "verification-error" })); } catch {}
      }
      state = LIFECYCLE_STATES.ROLLED_BACK;
      return Object.freeze({ ok: false, state, reason: "verification-error" });
    }
  }

  async function rollback(reason = "user-requested") {
    if (state !== LIFECYCLE_STATES.PREPARED && state !== LIFECYCLE_STATES.ACTIVE) {
      return Object.freeze({ ok: true, state, reason: "noop" });
    }
    try {
      if (lifecycle.rollback) await lifecycle.rollback(context({ reason }));
      state = LIFECYCLE_STATES.ROLLED_BACK;
      return Object.freeze({ ok: true, state, reason: "rolled-back" });
    } catch {
      return Object.freeze({ ok: false, state, reason: "rollback-failed" });
    }
  }

  async function probePathBound(task = {}) {
    if (!supported) {
      return Object.freeze({ result: "rejected", reason: "transparent-mode-unavailable" });
    }
    return Object.freeze(await probePath(Object.freeze({
      ...task,
      mode: selection.selected,
      backend: selection.backend?.id || "android-system-vpn",
      capabilities: Object.freeze({ ...capabilities }),
    })));
  }

  return Object.freeze({
    version: ANDROID_NATIVE_TRANSPARENT_BINDING_VERSION,
    platform: "android",
    requestedMode: selection.requested,
    mode: selection.selected,
    supported,
    reason: selection.reason,
    capabilities,
    selection,
    lifecycleState: () => state,
    prepare,
    apply,
    verify,
    rollback,
    probePath: probePathBound,
  });
}
