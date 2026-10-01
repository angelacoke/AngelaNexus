import { createTranslator } from "./translations.js";
import { createRuntimeViewModel } from "./semantic-state.js";

const RUNTIME_KEYS = Object.freeze({
  idle: "runtime.idle",
  preparing: "runtime.preparing",
  validating: "runtime.validating",
  starting: "runtime.starting",
  running: "runtime.running",
  degraded: "runtime.degraded",
  recovering: "runtime.recovering",
  stopped: "runtime.stopped",
  failed: "runtime.failed"
});

export function localizeRuntimeState(runtimeState, locale) {
  const translator = createTranslator(locale);
  const key = RUNTIME_KEYS[runtimeState.state];
  if (!key) throw new Error("unsupported runtime state: " + runtimeState.state);

  return Object.freeze({
    ...runtimeState,
    label: translator.t(key),
    locale: translator.locale,
    direction: translator.direction
  });
}

export function createLocalizedRuntimeViewModel(options = {}, locale) {
  const model = createRuntimeViewModel(options);
  const localizedRuntime = localizeRuntimeState(model.runtime, locale);

  return Object.freeze({
    ...model,
    runtime: localizedRuntime,
    locale: localizedRuntime.locale,
    direction: localizedRuntime.direction
  });
}

export { RUNTIME_KEYS };
