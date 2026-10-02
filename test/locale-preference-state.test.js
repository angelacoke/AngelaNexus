import test from "node:test";
import assert from "node:assert/strict";
import { createPersistedLocaleState, followSystemLocale, selectPersistedLocale, syncPersistedLocaleState } from "../src/ui/locale-preference-state.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("persisted locale is applied at state creation", () => {
  const s = storage();
  const first = createPersistedLocaleState({ systemLocale: "en-US", storage: s });
  assert.equal(first.state.locale, "en");
  const selected = selectPersistedLocale(first, "fa-IR");
  assert.equal(selected.state.locale, "fa");
  const restored = createPersistedLocaleState({ systemLocale: "zh-CN", storage: s });
  assert.equal(restored.state.locale, "fa");
  assert.equal(restored.state.source, "user");
});

test("following system clears persisted user override", () => {
  const s = storage();
  const context = createPersistedLocaleState({ systemLocale: "ru-RU", storage: s });
  const selected = selectPersistedLocale(context, "zh-CN");
  const reset = followSystemLocale(selected, "fa-IR");
  assert.equal(reset.state.locale, "fa");
  assert.equal(reset.state.userLocale, null);
  const restored = createPersistedLocaleState({ systemLocale: "fa-IR", storage: s });
  assert.equal(restored.state.locale, "fa");
  assert.equal(restored.state.source, "system");
});

test("system changes preserve persisted explicit locale", () => {
  const s = storage();
  const context = createPersistedLocaleState({ systemLocale: "en-US", storage: s });
  const selected = selectPersistedLocale(context, "ru-RU");
  const synced = syncPersistedLocaleState(selected, "fa-IR");
  assert.equal(synced.state.locale, "ru");
  assert.equal(synced.state.systemLocale, "fa");
  assert.equal(synced.state.userLocale, "ru");
});

test("sync without persisted preference follows system", () => {
  const s = storage();
  const context = createPersistedLocaleState({ systemLocale: "en-US", storage: s });
  const synced = syncPersistedLocaleState(context, "fa-IR");
  assert.equal(synced.state.locale, "fa");
  assert.equal(synced.state.source, "system");
});

test("locale persistence remains presentation-only", () => {
  const s = storage();
  const context = createPersistedLocaleState({ systemLocale: "en-US", storage: s });
  const selected = selectPersistedLocale(context, "zh-CN");
  assert.equal(selected.state.locale, "zh-CN");
  assert.equal(selected.state.userLocale, "zh-CN");
  assert.equal(Object.prototype.hasOwnProperty.call(selected.state, "networkPolicy"), false);
});
