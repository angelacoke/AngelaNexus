import { createTranslator } from "./translations.js";
import { UI_RUNTIME_LABEL_KEYS, createRuntimeViewModel } from "./semantic-state.js";
const RUNTIME_KEYS = UI_RUNTIME_LABEL_KEYS;
export function localizeRuntimeState(runtimeState, locale) {
  const translator = createTranslator(locale);
  const key = RUNTIME_KEYS[runtimeState.state];
  if (!key) throw new Error("unsupported runtime state: " + runtimeState.state);
  return Object.freeze({ ...runtimeState, label: translator.t(key), locale: translator.locale, direction: translator.direction });
}
export function createLocalizedRuntimeViewModel(options = {}, locale) {
  const model = createRuntimeViewModel(options);
  const localizedRuntime = localizeRuntimeState(model.runtime, locale);
  return Object.freeze({ ...model, runtime: localizedRuntime, locale: localizedRuntime.locale, direction: localizedRuntime.direction });
}
export { RUNTIME_KEYS };
