const assert = require("node:assert/strict");
const test = require("node:test");
const {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_METADATA,
  resolveLocale,
  createLocaleState,
} = require("../src/ui/localization");

test("supports the four product UI locales", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "zh-CN", "ru", "fa"]);
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(LOCALE_METADATA["zh-CN"].nativeName, "简体中文");
  assert.equal(LOCALE_METADATA.ru.nativeName, "Русский");
  assert.equal(LOCALE_METADATA.fa.nativeName, "فارسی");
});

test("locale resolution falls back to English", () => {
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("zh-CN"), "zh-CN");
  assert.equal(resolveLocale("ru"), "ru");
  assert.equal(resolveLocale("fa"), "fa");
  assert.equal(resolveLocale("de"), "en");
  assert.equal(resolveLocale(null), "en");
});

test("Persian is right-to-left", () => {
  assert.equal(createLocaleState("fa").direction, "rtl");
  assert.equal(createLocaleState("en").direction, "ltr");
});
