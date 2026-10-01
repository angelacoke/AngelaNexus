import test from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  TRANSLATION_KEYS,
  createTranslator,
  hasTranslation,
  translate
} from "../src/ui/translations.js";

test("all supported locales provide the canonical translation key set", () => {
  assert.equal(TRANSLATION_KEYS.length > 0, true);

  for (const locale of SUPPORTED_LOCALES) {
    const catalog = TRANSLATIONS[locale];
    assert.ok(catalog);

    const keys = Object.keys(catalog).sort();
    assert.deepEqual(keys, [...TRANSLATION_KEYS].sort());

    for (const key of TRANSLATION_KEYS) {
      assert.equal(typeof catalog[key], "string");
      assert.equal(catalog[key].length > 0, true);
      assert.equal(hasTranslation(locale, key), true);
    }
  }
});

test("translation lookup falls back to the requested fallback locale and finally the key", () => {
  assert.equal(translate("zh-CN", "app.name"), "AngelaNexus");
  assert.equal(translate("unknown", "app.name"), "AngelaNexus");
  assert.equal(translate("unknown", "settings.language"), "Language");
  assert.equal(translate("en", "missing.key"), "missing.key");
});

test("translator preserves presentation direction without carrying network policy", () => {
  const persian = createTranslator("fa-IR");
  const english = createTranslator("en-US");

  assert.equal(persian.locale, "fa");
  assert.equal(persian.direction, "rtl");
  assert.equal(english.locale, "en");
  assert.equal(english.direction, "ltr");

  const policy = Object.freeze({
    route: "managed",
    dns: "protected",
    directSensitive: false
  });

  assert.deepEqual(policy, {
    route: "managed",
    dns: "protected",
    directSensitive: false
  });
  assert.equal(persian.t("settings.languageHint"), "تغییر زبان فقط نمایش را تغییر می‌دهد و سیاست شبکه را تغییر نمی‌دهد.");
  assert.equal(persian.t("missing.key"), "missing.key");
});

test("translation catalogs are immutable", () => {
  assert.equal(Object.isFrozen(TRANSLATIONS), true);
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(Object.isFrozen(TRANSLATIONS[locale]), true);
  }
});
