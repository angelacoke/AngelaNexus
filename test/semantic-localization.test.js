import test from "node:test";
import assert from "node:assert/strict";

import {
  createLocalizedRuntimeViewModel,
  localizeRuntimeState
} from "../src/ui/semantic-localization.js";
import { toUiRuntimeState } from "../src/ui/semantic-state.js";

test("runtime semantic state can be localized without changing its meaning", () => {
  const source = toUiRuntimeState("running");
  const localized = localizeRuntimeState(source, "zh-CN");

  assert.equal(localized.state, "running");
  assert.equal(localized.proxyClaimAllowed, true);
  assert.equal(localized.label, "运行中");
  assert.equal(localized.locale, "zh-CN");
  assert.equal(localized.direction, "ltr");
});

test("Persian runtime presentation is RTL while execution semantics remain unchanged", () => {
  const model = createLocalizedRuntimeViewModel({
    experienceState: "degraded",
    vpnState: "inactive",
    routeState: "managed",
    dnsState: "protected",
    antiLeakState: "healthy",
    gfwState: "observing",
    syncState: "idle"
  }, "fa-IR");

  assert.equal(model.runtime.state, "degraded");
  assert.equal(model.runtime.proxyClaimAllowed, true);
  assert.equal(model.runtime.label, "اجرای محدود");
  assert.equal(model.direction, "rtl");
  assert.equal(model.locale, "fa");
  assert.equal(model.routeState, "managed");
  assert.equal(model.dnsState, "protected");
});

test("localization does not introduce or alter network policy fields", () => {
  const model = createLocalizedRuntimeViewModel({
    experienceState: "running",
    routeState: "managed",
    dnsState: "protected"
  }, "ru-RU");

  assert.equal(model.routeState, "managed");
  assert.equal(model.dnsState, "protected");
  assert.equal(Object.prototype.hasOwnProperty.call(model, "networkPolicy"), false);
  assert.equal(model.runtime.proxyClaimAllowed, true);
});

test("unsupported semantic states still fail closed", () => {
  assert.throws(
    () => localizeRuntimeState({ state: "connected" }, "en"),
    /unsupported runtime state/
  );
});
