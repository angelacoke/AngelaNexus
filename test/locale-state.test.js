import test from "node:test";
import assert from "node:assert/strict";

import {
  LOCALE_STATE_SOURCES,
  createLocaleState,
  setUserLocale,
  updateSystemLocale,
  useSystemLocale,
} from "../src/ui/locale-state.js";

test("locale state resolves system locale safely", () => {
  const state = createLocaleState({ systemLocale: "zh-CN" });

  assert.equal(state.locale, "zh-CN");
  assert.equal(state.direction, "ltr");
  assert.equal(state.source, LOCALE_STATE_SOURCES.SYSTEM);
  assert.equal(state.userLocale, null);
});

test("explicit user locale overrides system locale", () => {
  const state = createLocaleState({
    systemLocale: "en-US",
    userLocale: "fa-IR",
  });

  assert.equal(state.locale, "fa");
  assert.equal(state.direction, "rtl");
  assert.equal(state.source, LOCALE_STATE_SOURCES.USER);
  assert.equal(state.userLocale, "fa");
  assert.equal(state.systemLocale, "en");
});

test("invalid locale input falls back without producing an unsupported locale", () => {
  const state = createLocaleState({
    systemLocale: "xx-YY",
    userLocale: "not-a-locale",
  });

  assert.equal(state.locale, "en");
  assert.equal(state.direction, "ltr");
  assert.equal(state.source, LOCALE_STATE_SOURCES.USER);
});

test("resetting to system removes the user override", () => {
  const initial = createLocaleState({
    systemLocale: "fa-IR",
    userLocale: "ru-RU",
  });
  const next = useSystemLocale(initial);

  assert.equal(next.locale, "fa");
  assert.equal(next.direction, "rtl");
  assert.equal(next.source, LOCALE_STATE_SOURCES.SYSTEM);
  assert.equal(next.userLocale, null);
  assert.equal(initial.locale, "ru");
});

test("system locale changes preserve an explicit user choice", () => {
  const initial = createLocaleState({
    systemLocale: "en-US",
    userLocale: "ru-RU",
  });
  const next = updateSystemLocale(initial, "fa-IR");

  assert.equal(next.locale, "ru");
  assert.equal(next.userLocale, "ru");
  assert.equal(next.systemLocale, "fa");
  assert.equal(next.source, LOCALE_STATE_SOURCES.USER);
});

test("system locale changes take effect when no user override exists", () => {
  const initial = createLocaleState({ systemLocale: "en-US" });
  const next = updateSystemLocale(initial, "fa-IR");

  assert.equal(next.locale, "fa");
  assert.equal(next.direction, "rtl");
  assert.equal(next.source, LOCALE_STATE_SOURCES.SYSTEM);
});

test("state transitions do not mutate the previous frozen state", () => {
  const initial = createLocaleState({ systemLocale: "en-US" });
  const next = setUserLocale(initial, "zh-CN");

  assert.notEqual(next, initial);
  assert.equal(initial.locale, "en");
  assert.equal(next.locale, "zh-CN");
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(Object.isFrozen(next), true);
});
