import { validateSecurityPolicy } from "./security.js";
import { createGfwPolicy, validateGfwPolicy } from "./gfw-policy.js";

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
  ruleSourceProtection: true,
  ruleSourceRequireSignature: true,
  ruleSourceRequireDigest: true,
  ruleSourceRequireFreshness: true,
  applicationIntegrityProtection: true,
  blockWebRTC3478: true,
  ipv6LeakBlackhole: true,
  encryptedDns: true,
  gfwResilience: createGfwPolicy(),
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
  "secretProtection", "configIntegrityProtection", "runtimeVerification",
  "ruleSourceProtection", "ruleSourceRequireSignature", "ruleSourceRequireDigest",
  "ruleSourceRequireFreshness", "applicationIntegrityProtection",
  "blockWebRTC3478", "ipv6LeakBlackhole", "encryptedDns"
]);

const SECURITY_KEYS = Object.freeze([
  "failClosed", "killSwitch", "dnsLeakPrevention", "ipv4LeakPrevention",
  "ipv6LeakPrevention", "udpLeakPrevention", "quicLeakPrevention",
  "tunBypassPrevention", "systemProxyBypassPrevention", "appBypassPrevention",
  "secureDnsBootstrap", "startupRaceProtection", "subscriptionUpdateProtection",
  "secretProtection", "configIntegrityProtection", "runtimeVerification",
  "ruleSourceProtection", "ruleSourceRequireSignature", "ruleSourceRequireDigest",
  "ruleSourceRequireFreshness", "applicationIntegrityProtection",
  "blockWebRTC3478", "ipv6LeakBlackhole", "encryptedDns", "gfwResilience"
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
    gfwResilience: createGfwPolicy(source.gfwResilience),
    chinaNetworkOptimization: {
      ...clone(SystemSecurityDefaults.chinaNetworkOptimization),
      ...china
    }
  };
}

function error(code, key, message, value) {
  return Object.freeze({ code, severity: "error", key, message, value });
}

/**
 * Compose the immutable system security floor with user-provided security
 * preferences. User settings are preserved when compatible; a user request
 * that weakens a mandatory security invariant is rejected at the effective
 * layer and recorded as an explicit conflict instead of being silently lost.
 *
 * Routing and optimization preferences are not overwritten here. They remain
 * user-owned unless a separate security invariant proves the requested path
 * unsafe.
 */
export function composeSecurityPolicy(systemOverrides = {}, userConfig = {}) {
  const system = mergePolicy(systemOverrides);
  const user = userConfig && typeof userConfig === "object" ? userConfig : {};
  const userSecurity = user.security && typeof user.security === "object" ? user.security : {};
  const effective = { ...system };
  const conflicts = [];
  const preserved = [];

  for (const key of SECURITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(userSecurity, key)) continue;
    const value = userSecurity[key];
    if (REQUIRED_TRUE.includes(key) && value !== true) {
      conflicts.push(Object.freeze({
        key,
        code: "USER_SECURITY_WEAKER_THAN_SYSTEM_FLOOR",
        requested: value,
        effective: true,
        resolution: "system-floor"
      }));
      effective[key] = true;
    } else {
      effective[key] = value;
      preserved.push(key);
    }
  }

  const systemGfw = system.gfwResilience;
  const userGfw = userSecurity.gfwResilience;
  if (userGfw && typeof userGfw === "object") {
    const requested = createGfwPolicy(userGfw);
    effective.gfwResilience = { ...clone(systemGfw), ...clone(requested) };
    if (userGfw.enabled === false) {
      conflicts.push(Object.freeze({ key: "gfwResilience.enabled", code: "USER_SECURITY_WEAKER_THAN_SYSTEM_FLOOR", requested: false, effective: true, resolution: "system-floor" }));
      effective.gfwResilience.enabled = true;
    }
    if (userGfw.failClosed === false) {
      conflicts.push(Object.freeze({ key: "gfwResilience.failClosed", code: "USER_SECURITY_WEAKER_THAN_SYSTEM_FLOOR", requested: false, effective: true, resolution: "system-floor" }));
      effective.gfwResilience.failClosed = true;
    }
    for (const key of ["mode", "minEvidence", "confirmationScore", "maxObservationAgeMs", "avoidQuicOnConfirmed", "requireSecureDnsOnInjection"]) {
      if (Object.prototype.hasOwnProperty.call(userGfw, key)) preserved.push("gfwResilience." + key);
    }
  }

  const systemChina = system.chinaNetworkOptimization;
  const userChina = userSecurity.chinaNetworkOptimization;
  if (userChina && typeof userChina === "object") {
    effective.chinaNetworkOptimization = {
      ...clone(systemChina),
      ...clone(userChina)
    };
    if (Object.prototype.hasOwnProperty.call(userChina, "failClosed") && userChina.failClosed !== true) {
      conflicts.push(Object.freeze({
        key: "chinaNetworkOptimization.failClosed",
        code: "USER_SECURITY_WEAKER_THAN_SYSTEM_FLOOR",
        requested: userChina.failClosed,
        effective: true,
        resolution: "system-floor"
      }));
      effective.chinaNetworkOptimization.failClosed = true;
    }
    for (const key of ["enabled", "domesticAction", "foreignAction", "dnsMode"]) {
      if (Object.prototype.hasOwnProperty.call(userChina, key)) {
        preserved.push("chinaNetworkOptimization." + key);
      }
    }
  }

  return Object.freeze({
    version: SECURITY_POLICY_VERSION,
    policy: Object.freeze(clone(effective)),
    conflicts: Object.freeze(conflicts),
    preserved: Object.freeze(preserved)
  });
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

  const gfw = policy.gfwResilience;
  if (!gfw || typeof gfw !== "object") {
    errors.push(error("GFW_POLICY_INVALID", "gfwResilience", "GFW resilience policy must be an object", gfw));
  } else {
    const gfwValidation = validateGfwPolicy(gfw);
    errors.push(...gfwValidation.errors.map((item) => error(item.code, item.key, item.message, gfw[item.key?.split(".").pop()])));
    if (gfw.enabled !== true) errors.push(error("GFW_RESILIENCE_REQUIRED", "gfwResilience.enabled", "GFW resilience policy must remain enabled", gfw.enabled));
    if (gfw.failClosed !== true) errors.push(error("GFW_FAIL_CLOSED_REQUIRED", "gfwResilience.failClosed", "GFW resilience policy must remain fail-closed", gfw.failClosed));
  }

  const china = policy.chinaNetworkOptimization;
  if (!china || typeof china !== "object") {
    errors.push(error("CHINA_POLICY_INVALID", "chinaNetworkOptimization", "China network optimization policy must be an object", china));
  } else {
    if (![true, false].includes(china.enabled)) {
      errors.push(error("CHINA_ENABLED_INVALID", "chinaNetworkOptimization.enabled", "China network optimization enabled must be boolean", china.enabled));
    }
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
  const checks = SECURITY_KEYS.map((key) => Object.freeze({
    key,
    status: key === "gfwResilience"
      ? (policy[key] && policy[key].enabled === true && policy[key].failClosed === true ? "enabled" : "failed")
      : (policy[key] === true ? "enabled" : "failed")
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
