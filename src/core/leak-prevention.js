import { SystemSecurityDefaults } from "./system-security-policy.js";

export const LeakActions = Object.freeze({
  PROXY: "proxy",
  CHAIN: "chain",
  DIRECT: "direct",
  REJECT: "reject"
});

const SENSITIVE_TRANSPORTS = Object.freeze(["dns", "udp", "quic", "webrtc", "stun"]);

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function effectivePolicy(policy = {}) {
  const source = policy && typeof policy === "object" ? policy : {};
  return {
    ...structuredClone(SystemSecurityDefaults),
    ...source
  };
}

function reject(reason, evidence = {}) {
  return Object.freeze({
    action: LeakActions.REJECT,
    allowed: false,
    reason,
    evidence: Object.freeze({ ...evidence })
  });
}

function allow(action, reason, evidence = {}) {
  return Object.freeze({
    action,
    allowed: true,
    reason,
    evidence: Object.freeze({ ...evidence })
  });
}

/**
 * Decide whether a network operation may leave the Nexus-managed path.
 * This is deliberately kernel-independent: runtime compilers are responsible
 * for translating the decision into native kernel configuration.
 */
export function evaluateLeakRisk(event = {}, policy = {}) {
  const effective = effectivePolicy(policy);
  const transport = normalized(event.transport || event.protocol);
  const addressFamily = normalized(event.addressFamily || event.family);
  const path = normalized(event.path || event.route);
  const bootstrap = event.bootstrap === true;
  const bypass = event.bypass === true;

  if (effective.failClosed !== true) {
    return reject("fail-closed policy is not enabled");
  }

  if (bypass && (
    effective.tunBypassPrevention !== true ||
    effective.systemProxyBypassPrevention !== true ||
    effective.appBypassPrevention !== true
  )) {
    return reject("bypass safety cannot be established", { bypass: true });
  }

  if (addressFamily === "ipv6" && effective.ipv6LeakPrevention === true) {
    if (path !== "managed" && path !== "proxy" && path !== "chain") {
      return reject("IPv6 path is not managed", { addressFamily, path });
    }
  }

  if (addressFamily === "ipv4" && effective.ipv4LeakPrevention === true) {
    if (path === "bypass" || path === "unknown") {
      return reject("IPv4 path is not managed", { addressFamily, path });
    }
  }

  if (transport === "dns" && effective.dnsLeakPrevention === true) {
    if (bootstrap && effective.secureDnsBootstrap !== true) {
      return reject("DNS bootstrap is not protected", { bootstrap: true });
    }
    if (path !== "managed" && path !== "proxy" && path !== "chain") {
      return reject("DNS would leave the managed path", { transport, path });
    }
  }

  if (transport === "udp" && effective.udpLeakPrevention === true && path === "direct") {
    return reject("direct UDP path is prohibited by leak policy", { transport, path });
  }

  if ((transport === "quic" || transport === "webrtc" || transport === "stun") &&
      (effective.quicLeakPrevention === true || effective.udpLeakPrevention === true)) {
    if (path === "direct" || path === "bypass" || path === "unknown") {
      return reject("direct UDP/QUIC-style path is prohibited", { transport, path });
    }
  }

  if (transport && SENSITIVE_TRANSPORTS.includes(transport) && path === "unknown") {
    return reject("sensitive transport path is unknown", { transport, path });
  }

  if (path === "chain") return allow(LeakActions.CHAIN, "managed chain path");
  if (path === "proxy" || path === "managed") return allow(LeakActions.PROXY, "managed proxy path");

  if (path === "direct") {
    return allow(LeakActions.DIRECT, "direct path explicitly permitted for non-sensitive traffic");
  }

  return reject("network path could not be established", { transport, path });
}

export function isLeakSafe(event = {}, policy = {}) {
  return evaluateLeakRisk(event, policy).allowed;
}

export function assertLeakSafe(event = {}, policy = {}) {
  const result = evaluateLeakRisk(event, policy);
  if (!result.allowed) {
    const error = new Error("Nexus rejected unsafe network path: " + result.reason);
    error.code = "UNSAFE_NETWORK_PATH";
    error.result = result;
    throw error;
  }
  return result;
}
