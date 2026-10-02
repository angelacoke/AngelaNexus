import { DEFAULT_LOCALE, resolveLocale } from "./localization.js";

export const LOCALE_PREFERENCE_KEY = "angelanexus.locale";
export const LOCALE_PREFERENCE_VERSION = 1;

function normalizeStoredLocale(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return resolveLocale(value, DEFAULT_LOCALE);
}

export function serializeLocalePreference(locale) {
  return JSON.stringify({
    version: LOCALE_PREFERENCE_VERSION,
    locale: resolveLocale(locale, DEFAULT_LOCALE)
  });
}

export function parseLocalePreference(serialized) {
  if (typeof serialized !== "string" || serialized.trim() === "") return null;
  try {
    const value = JSON.parse(serialized);
    if (!value || value.version !== LOCALE_PREFERENCE_VERSION) return null;
    return normalizeStoredLocale(value.locale);
  } catch {
    return null;
  }
}

export function loadLocalePreference(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  return parseLocalePreference(storage.getItem(LOCALE_PREFERENCE_KEY));
}

export function saveLocalePreference(storage, locale) {
  if (!storage || typeof storage.setItem !== "function") return false;
  storage.setItem(LOCALE_PREFERENCE_KEY, serializeLocalePreference(locale));
  return true;
}

export function clearLocalePreference(storage) {
  if (!storage || typeof storage.removeItem !== "function") return false;
  storage.removeItem(LOCALE_PREFERENCE_KEY);
  return true;
}

export function createLocalePreferenceStore(storage) {
  return Object.freeze({
    load: () => loadLocalePreference(storage),
    save: (locale) => saveLocalePreference(storage, locale),
    clear: () => clearLocalePreference(storage)
  });
}
