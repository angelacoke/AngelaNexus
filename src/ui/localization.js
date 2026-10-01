const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN", "ru", "fa"]);
const DEFAULT_LOCALE = "en";
const LOCALE_METADATA = Object.freeze({
  en: Object.freeze({ code: "en", name: "English", nativeName: "English", direction: "ltr" }),
  "zh-CN": Object.freeze({ code: "zh-CN", name: "Simplified Chinese", nativeName: "简体中文", direction: "ltr" }),
  ru: Object.freeze({ code: "ru", name: "Russian", nativeName: "Русский", direction: "ltr" }),
  fa: Object.freeze({ code: "fa", name: "Persian", nativeName: "فارسی", direction: "rtl" }),
});

function normalizeLocale(locale) {
  if (typeof locale !== "string") return "";
  return locale.trim().replace(/_/g, "-");
}

function findSupportedLocale(locale) {
  const normalized = normalizeLocale(locale);
  if (!normalized) return null;

  const exact = SUPPORTED_LOCALES.indexOf(normalized);
  if (exact !== -1) return SUPPORTED_LOCALES[exact];

  const language = normalized.split("-")[0].toLowerCase();
  if (language === "zh") return "zh-CN";
  if (SUPPORTED_LOCALES.indexOf(language) !== -1) return language;
  return null;
}

function isSupportedLocale(locale) {
  return findSupportedLocale(locale) !== null;
}

function resolveLocale(requestedLocale, fallback = DEFAULT_LOCALE) {
  return findSupportedLocale(requestedLocale) ||
    findSupportedLocale(fallback) ||
    DEFAULT_LOCALE;
}

function getLocaleMetadata(locale) {
  return LOCALE_METADATA[resolveLocale(locale)];
}

function createLocaleState(locale = DEFAULT_LOCALE) {
  const resolved = resolveLocale(locale);
  return Object.freeze({
    locale: resolved,
    direction: LOCALE_METADATA[resolved].direction,
  });
}

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  isSupportedLocale,
  resolveLocale,
  getLocaleMetadata,
  createLocaleState,
};
