import { validateSecurityPolicy } from "./security.js";

export const SECURITY_POLICY_VERSION = 1;

export const SystemSecurityDefaults = Object.freeze({
  failClosed: true,
  killSwitch: true,
  dnsLeakPrevention: true,
  ipv4LeakPrevention: true,
  ipv6LeakPrevention: true,
  udpLeakPrevention: true,
  quicLeakPrevention: true,
  tunBypassPrevention: true,
  systemProxyBypassPrevention: true,
  appBypassPrevention: true,
  secureDnsBootstrap: true,
  startupRaceProtection: true,
  subscriptionUpdateProtection: true,
  secretProtection: true,
  configIntegrityProtection: true,
  runtimeVerification: true,
  chinaNetworkOptimization: {
    enabled: true,
    domesticAction: "direct",
    foreignAction: "proxy",
    dnsMode: "secure",
    failClosed: true
  }
});

const REQUIRED_TRUE = Object.freeze([
  "failClosed", "killSwitch", "dnsLeakPrevention", "ipv4LeakPrevention",
  "ipv6LeakPrevention", "udpLeakPrevention", "quicLeakPrevention",
  "tunBypassPrevention", "systemProxyBypassPrevention", "appBypassPrevention",
  "secureDnsBootstrap", "startupRaceProtection", "subscriptionUpdateProtection",
  "secretProtection", "configIntegrityProtection", "runtimeVerification"
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function mergePolicy(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const china = source.chinaNetworkOptimization && typeof source.chinaNetworkOptimization === "object"
    ? source.chinaNetworkOptimization : {};
  return {
    ...clone(SystemSecurityDefaults),
    ...source,
    chinaNetworkOptimization: {
      ...clone(SystemSecurityDefaults.chinaNetworkOptimization),
      ...china
    }
  };
}

function error(code, key, message, value) {
  return Object.freeze({ code, severity: "error", key, message, value });
}

export function createSystemSecurityPolicy(overrides = {}) {
  const policy = mergePolicy(overrides);
  const errors = [];

  for (const key of REQUIRED_TRUE) {
    if (policy[key] !== true) {
      errors.push(error(
        "SECURITY_REQUIREMENT_DISABLED",
        key,
        "system security policy requires this protection to remain enabled",
        policy[key]
      ));
    }
  }

  const china = policy.chinaNetworkOptimization;
  if (!china || typeof china !== "object") {
    errors.push(error("CHINA_POLICY_INVALID", "chinaNetworkOptimization", "China network optimization policy must be an object", china));
  } else {
    if (!["direct", "proxy", "reject"].includes(china.domesticAction)) {
      errors.push(error("CHINA_DOMESTIC_ACTION_INVALID", "chinaNetworkOptimization.domesticAction", "domestic action must be direct, proxy, or reject", china.domesticAction));
    }
    if (!["proxy", "chain", "reject"].includes(china.foreignAction)) {
      errors.push(error("CHINA_FOREIGN_ACTION_INVALID", "chinaNetworkOptimization.foreignAction", "foreign action must be proxy, chain, or reject", china.foreignAction));
    }
    if (!["secure", "native", "reject"].includes(china.dnsMode)) {
      errors.push(error("CHINA_DNS_MODE_INVALID", "chinaNetworkOptimization.dnsMode", "DNS mode must be secure, native, or reject", china.dnsMode));
    }
    if (china.failClosed !== true) {
      errors.push(error("CHINA_FAIL_CLOSED_REQUIRED", "chinaNetworkOptimization.failClosed", "China network optimization must remain fail-closed", china.failClosed));
    }
  }

  return Object.freeze({
    version: SECURITY_POLICY_VERSION,
    ok: errors.length === 0,
    policy: Object.freeze(clone(policy)),
    errors: Object.freeze(errors)
  });
}

export function validateSystemSecurityPolicy(config = {}) {
  const system = config && typeof config === "object" && config.security
    ? config.security
    : config;
  const result = createSystemSecurityPolicy(system || {});
  const nativeSecurity = validateSecurityPolicy({
    ...(config && typeof config === "object" ? config : {}),
    security: result.policy
  });
  const errors = [...result.errors, ...nativeSecurity.errors];

  return Object.freeze({
    version: SECURITY_POLICY_VERSION,
    ok: errors.length === 0,
    policy: result.policy,
    errors: Object.freeze(errors)
  });
}

export function securityEvidence(config = {}) {
  const result = validateSystemSecurityPolicy(config);
  const policy = result.policy;
  const checks = [
    ["failClosed", policy.failClosed],
    ["killSwitch", policy.killSwitch],
    ["dnsLeakPrevention", policy.dnsLeakPrevention],
    ["ipv4LeakPrevention", policy.ipv4LeakPrevention],
    ["ipv6LeakPrevention", policy.ipv6LeakPrevention],
    ["udpLeakPrevention", policy.udpLeakPrevention],
    ["quicLeakPrevention", policy.quicLeakPrevention],
    ["tunBypassPrevention", policy.tunBypassPrevention],
    ["systemProxyBypassPrevention", policy.systemProxyBypassPrevention],
    ["appBypassPrevention", policy.appBypassPrevention],
    ["secureDnsBootstrap", policy.secureDnsBootstrap],
    ["startupRaceProtection", policy.startupRaceProtection],
    ["subscriptionUpdateProtection", policy.subscriptionUpdateProtection],
    ["secretProtection", policy.secretProtection],
    ["configIntegrityProtection", policy.configIntegrityProtection],
    ["runtimeVerification", policy.runtimeVerification]
  ].map(([key, enabled]) => Object.freeze({
    key,
    status: enabled === true ? "enabled" : "failed"
  }));

  return Object.freeze({
    version: SECURITY_POLICY_VERSION,
    status: result.ok ? "pass" : "fail",
    verifiable: true,
    claim: "engineering-target",
    checks: Object.freeze(checks),
    errors: result.errors
  });
}
