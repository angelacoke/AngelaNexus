import {
  DEFAULT_LOCALE,
  getLocaleMetadata,
  resolveLocale,
} from "./localization.js";

export const LOCALE_STATE_SOURCES = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  DEFAULT: "default",
});

function resolveSystemLocale(systemLocale) {
  return resolveLocale(systemLocale, DEFAULT_LOCALE);
}

function createLocaleState({ systemLocale, userLocale = null } = {}) {
  const hasUserLocale = typeof userLocale === "string" && userLocale.trim() !== "";
  const locale = hasUserLocale
    ? resolveLocale(userLocale, resolveSystemLocale(systemLocale))
    : resolveSystemLocale(systemLocale);

  const source = hasUserLocale
    ? LOCALE_STATE_SOURCES.USER
    : systemLocale
      ? LOCALE_STATE_SOURCES.SYSTEM
      : LOCALE_STATE_SOURCES.DEFAULT;

  const metadata = getLocaleMetadata(locale);

  return Object.freeze({
    locale,
    direction: metadata.direction,
    metadata,
    source,
    systemLocale: resolveSystemLocale(systemLocale),
    userLocale: hasUserLocale ? resolveLocale(userLocale) : null,
  });
}

export function setUserLocale(state, requestedLocale) {
  const current = state && typeof state === "object" ? state : {};
  const systemLocale = current.systemLocale || DEFAULT_LOCALE;
  const locale = resolveLocale(requestedLocale, systemLocale);
  const metadata = getLocaleMetadata(locale);

  return Object.freeze({
    locale,
    direction: metadata.direction,
    metadata,
    source: LOCALE_STATE_SOURCES.USER,
    systemLocale: resolveSystemLocale(systemLocale),
    userLocale: locale,
  });
}

export function useSystemLocale(state, systemLocale = null) {
  const current = state && typeof state === "object" ? state : {};
  const resolvedSystemLocale = resolveSystemLocale(
    systemLocale === null ? current.systemLocale : systemLocale
  );
  const metadata = getLocaleMetadata(resolvedSystemLocale);

  return Object.freeze({
    locale: resolvedSystemLocale,
    direction: metadata.direction,
    metadata,
    source: systemLocale || current.systemLocale
      ? LOCALE_STATE_SOURCES.SYSTEM
      : LOCALE_STATE_SOURCES.DEFAULT,
    systemLocale: resolvedSystemLocale,
    userLocale: null,
  });
}

export function updateSystemLocale(state, systemLocale) {
  const current = state && typeof state === "object" ? state : {};
  const resolvedSystemLocale = resolveSystemLocale(systemLocale);
  const activeUserLocale = current.userLocale;

  if (activeUserLocale) {
    return setUserLocale(
      { ...current, systemLocale: resolvedSystemLocale },
      activeUserLocale
    );
  }

  return useSystemLocale(
    { ...current, systemLocale: resolvedSystemLocale },
    resolvedSystemLocale
  );
}

export { createLocaleState };
