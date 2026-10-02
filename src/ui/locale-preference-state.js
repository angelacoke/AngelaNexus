import { createLocaleState, setUserLocale, updateSystemLocale, useSystemLocale } from "./locale-state.js";
import { createLocalePreferenceStore } from "./locale-preference.js";

export function createPersistedLocaleState({ systemLocale, storage } = {}) {
  const preferences = createLocalePreferenceStore(storage);
  const persistedLocale = preferences.load();
  return {
    state: createLocaleState({ systemLocale, userLocale: persistedLocale }),
    preferences
  };
}

export function selectPersistedLocale(context, requestedLocale) {
  const current = context && typeof context === "object" ? context : {};
  const preferences = current.preferences;
  if (!preferences || typeof preferences.save !== "function") throw new TypeError("locale preference store is required");
  const state = setUserLocale(current.state, requestedLocale);
  preferences.save(state.locale);
  return Object.freeze({ state, preferences });
}

export function followSystemLocale(context, systemLocale = null) {
  const current = context && typeof context === "object" ? context : {};
  const preferences = current.preferences;
  if (!preferences || typeof preferences.clear !== "function") throw new TypeError("locale preference store is required");
  const state = useSystemLocale(current.state, systemLocale);
  preferences.clear();
  return Object.freeze({ state, preferences });
}

export function syncPersistedLocaleState(context, systemLocale) {
  const current = context && typeof context === "object" ? context : {};
  const preferences = current.preferences;
  if (!preferences || typeof preferences.load !== "function") throw new TypeError("locale preference store is required");
  const persistedLocale = preferences.load();
  if (persistedLocale) {
    return Object.freeze({
      state: setUserLocale({ ...current.state, systemLocale }, persistedLocale),
      preferences
    });
  }
  return Object.freeze({
    state: updateSystemLocale({ ...current.state, userLocale: null }, systemLocale),
    preferences
  });
}
