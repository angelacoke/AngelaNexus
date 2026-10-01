const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN", "ru", "fa"]);
const DEFAULT_LOCALE = "en";
const LOCALE_METADATA = Object.freeze({
  en: Object.freeze({ code: "en", name: "English", nativeName: "English", direction: "ltr" }),
  "zh-CN": Object.freeze({ code: "zh-CN", name: "Simplified Chinese", nativeName: "简体中文", direction: "ltr" }),
  ru: Object.freeze({ code: "ru", name: "Russian", nativeName: "Русский", direction: "ltr" }),
  fa: Object.freeze({ code: "fa", name: "Persian", nativeName: "فارسی", direction: "rtl" })
});
function isSupportedLocale(locale) { return SUPPORTED_LOCALES.indexOf(locale) !== -1; }
function resolveLocale(requestedLocale, fallback = DEFAULT_LOCALE) {
  if (isSupportedLocale(requestedLocale)) return requestedLocale;
  if (isSupportedLocale(fallback)) return fallback;
  return DEFAULT_LOCALE;
}
function getLocaleMetadata(locale) { return LOCALE_METADATA[resolveLocale(locale)]; }
function createLocaleState(locale = DEFAULT_LOCALE) {
  const resolved = resolveLocale(locale);
  return Object.freeze({ locale: resolved, direction: LOCALE_METADATA[resolved].direction });
}
module.exports = { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_METADATA, isSupportedLocale, resolveLocale, getLocaleMetadata, createLocaleState };
