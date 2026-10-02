import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCALE_PREFERENCE_KEY,
  LOCALE_PREFERENCE_VERSION,
  clearLocalePreference,
  createLocalePreferenceStore,
  loadLocalePreference,
  parseLocalePreference,
  saveLocalePreference,
  serializeLocalePreference
} from "../src/ui/locale-preference.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

test("locale preference serializes with a versioned schema", () => {
  assert.equal(serializeLocalePreference("fa-IR"), JSON.stringify({ version: LOCALE_PREFERENCE_VERSION, locale: "fa" }));
});

test("invalid or incompatible stored preferences fail safely", () => {
  assert.equal(parseLocalePreference("not-json"), null);
  assert.equal(parseLocalePreference(JSON.stringify({ version: 999, locale: "fa" })), null);
  assert.equal(parseLocalePreference(JSON.stringify({ version: 1, locale: "xx" })), "en");
});

test("preference storage round-trips the explicit user locale", () => {
  const storage = memoryStorage();
  assert.equal(saveLocalePreference(storage, "zh-CN"), true);
  assert.equal(storage.getItem(LOCALE_PREFERENCE_KEY), JSON.stringify({ version: 1, locale: "zh-CN" }));
  assert.equal(loadLocalePreference(storage), "zh-CN");
});

test("clearing preference returns control to the system locale layer", () => {
  const storage = memoryStorage();
  saveLocalePreference(storage, "ru");
  assert.equal(clearLocalePreference(storage), true);
  assert.equal(loadLocalePreference(storage), null);
});

test("preference store exposes only locale persistence operations", () => {
  const storage = memoryStorage();
  const store = createLocalePreferenceStore(storage);
  assert.equal(store.save("fa"), true);
  assert.equal(store.load(), "fa");
  assert.equal(store.clear(), true);
  assert.equal(store.load(), null);
  assert.deepEqual(Object.keys(store), ["load", "save", "clear"]);
});
