export const TRANSPARENT_PROXY_MODES = Object.freeze({
  TUN: "tun",
  SYSTEM_VPN: "system-vpn",
  REDIRECT: "redirect",
});

export const TRANSPARENT_PROXY_STATES = Object.freeze({
  DISABLED: "disabled",
  READY: "ready",
  ACTIVE: "active",
  BLOCKED: "blocked",
  ERROR: "error",
});

const DEFAULTS = Object.freeze({
  mode: TRANSPARENT_PROXY_MODES.TUN,
  ipv4: true,
  ipv6: true,
  udp: true,
  dnsCapture: true,
  routeAll: true,
  failClosed: true,
  bypassLocal: true,
});

function bool(value, fallback) {
  return value === undefined ? fallback : Boolean(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function createTransparentProxyConfig(options = {}) {
  const mode = text(options.mode) || DEFAULTS.mode;
  if (!Object.values(TRANSPARENT_PROXY_MODES).includes(mode)) {
    throw new Error("unsupported transparent proxy mode: " + mode);
  }

  const config = {
    version: 1,
    enabled: Boolean(options.enabled),
    mode,
    capture: Object.freeze({
      ipv4: bool(options.ipv4, DEFAULTS.ipv4),
      ipv6: bool(options.ipv6, DEFAULTS.ipv6),
      udp: bool(options.udp, DEFAULTS.udp),
      dnsCapture: bool(options.dnsCapture, DEFAULTS.dnsCapture),
    }),
    routing: Object.freeze({
      routeAll: bool(options.routeAll, DEFAULTS.routeAll),
      bypassLocal: bool(options.bypassLocal, DEFAULTS.bypassLocal),
    }),
    security: Object.freeze({
      failClosed: bool(options.failClosed, DEFAULTS.failClosed),
      allowDirectFallback: false,
    }),
  };

  if (!config.capture.ipv4 && !config.capture.ipv6) {
    throw new Error("transparent proxy must capture at least one IP family");
  }
  if (!config.security.failClosed) {
    throw new Error("transparent proxy fail-closed protection cannot be disabled");
  }

  return Object.freeze(config);
}

export function evaluateTransparentProxy(config, runtime = {}) {
  if (!config || config.enabled !== true) {
    return Object.freeze({
      state: TRANSPARENT_PROXY_STATES.DISABLED,
      active: false,
      failClosed: true,
      reason: "transparent-proxy-disabled",
    });
  }

  const required = [];
  if (config.capture.ipv4) required.push("ipv4");
  if (config.capture.ipv6) required.push("ipv6");
  if (config.capture.udp) required.push("udp");
  if (config.capture.dnsCapture) required.push("dns-capture");

  const unsupported = required.filter((capability) => runtime[capability] === false);
  if (unsupported.length) {
    return Object.freeze({
      state: TRANSPARENT_PROXY_STATES.BLOCKED,
      active: false,
      failClosed: true,
      reason: "required-capture-capability-unavailable",
      unsupported: Object.freeze(unsupported),
    });
  }

  if (runtime.permission === false || runtime.ready === false) {
    return Object.freeze({
      state: TRANSPARENT_PROXY_STATES.ERROR,
      active: false,
      failClosed: true,
      reason: runtime.permission === false ? "capture-permission-denied" : "capture-runtime-not-ready",
    });
  }

  return Object.freeze({
    state: runtime.active === true ? TRANSPARENT_PROXY_STATES.ACTIVE : TRANSPARENT_PROXY_STATES.READY,
    active: runtime.active === true,
    failClosed: true,
    mode: config.mode,
  });
}

export function createTransparentProxyDecision(config, runtime = {}) {
  const evaluation = evaluateTransparentProxy(config, runtime);
  if (evaluation.state === TRANSPARENT_PROXY_STATES.ACTIVE) {
    return Object.freeze({
      type: "capture",
      mode: config.mode,
      target: "platform-routing",
      failClosed: true,
      evaluation,
    });
  }

  if (config && config.enabled === true) {
    return Object.freeze({
      type: "reject",
      target: "reject",
      reason: evaluation.reason || "transparent-proxy-unavailable",
      failClosed: true,
      evaluation,
    });
  }

  return Object.freeze({
    type: "disabled",
    target: "platform-routing",
    failClosed: true,
    evaluation,
  });
}
