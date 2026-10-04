/**
 * AngelaNexus platform precision matcher.
 *
 * This module only answers whether one concrete rule matches one observed
 * flow identity. It never orders rules, selects a route, or invokes a kernel.
 *
 * Within one rule, supplied dimensions are conjunctive (AND). Multiple
 * values of the same dimension are alternatives (OR). Every rule is still
 * evaluated independently by the parallel Match Set engine.
 */

function text(value) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim().toLowerCase();
  return result || null;
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const scalar = text(value);
  return scalar ? [scalar] : [];
}

function oneOf(actual, expectedValues) {
  const actualValue = text(actual);
  const values = list(expectedValues);
  return Boolean(actualValue && values.length && values.includes(actualValue));
}

function domainEquals(actual, expected) {
  return text(actual) === text(expected);
}

function domainSuffix(actual, expected) {
  const a = text(actual);
  const e = text(expected)?.replace(/^\./, "");
  return Boolean(a && e && (a === e || a.endsWith("." + e)));
}

function parseIPv4(value) {
  const parts = text(value)?.split(".");
  if (!parts || parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const nums = parts.map(Number);
  if (nums.some((part) => part < 0 || part > 255)) return null;
  return nums.reduce((result, part) => result * 256 + part, 0);
}

function ipv4InCidr(ip, cidr) {
  const [network, prefixText] = text(cidr)?.split("/") || [];
  const address = parseIPv4(ip);
  const base = parseIPv4(network);
  const prefix = Number(prefixText);
  if (address === null || base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return ((address >>> 0) & mask) === ((base >>> 0) & mask);
}

function hexIPv6(value) {
  const raw = text(value)?.replace(/^\[|\]$/g, "");
  if (!raw || raw.includes("%")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const expand = (parts) => {
    const result = [];
    for (const part of parts) {
      if (part.includes(".")) {
        const ipv4 = parseIPv4(part);
        if (ipv4 === null) return null;
        result.push((ipv4 >>> 16).toString(16), (ipv4 & 0xffff).toString(16));
      } else if (/^[0-9a-f]{1,4}$/.test(part)) result.push(part);
      else return null;
    }
    return result;
  };
  const l = expand(left);
  const r = expand(right);
  if (!l || !r || (halves.length === 1 && l.length !== 8) || (halves.length === 2 && l.length + r.length >= 8)) return null;
  const groups = halves.length === 2 ? l.concat(new Array(8 - l.length - r.length).fill("0"), r) : l;
  return groups.map((group) => group.padStart(4, "0")).join("").toLowerCase();
}

function ipv6InCidr(ip, cidr) {
  const parts = text(cidr)?.split("/");
  if (!parts || parts.length !== 2) return false;
  const address = hexIPv6(ip);
  const network = hexIPv6(parts[0]);
  const prefix = Number(parts[1]);
  if (!address || !network || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;
  const full = Math.floor(prefix / 4);
  const remainder = prefix % 4;
  if (address.slice(0, full) !== network.slice(0, full)) return false;
  if (remainder === 0) return true;
  const mask = (0xf << (4 - remainder)) & 0xf;
  return (parseInt(address[full], 16) & mask) === (parseInt(network[full], 16) & mask);
}

function ipMatches(actual, expected) {
  const a = text(actual);
  const e = text(expected);
  if (!a || !e) return false;
  if (a === e) return true;
  return e.includes(":") ? ipv6InCidr(a, e) : ipv4InCidr(a, e);
}

function anyIpMatches(actual, expected) {
  const values = list(expected);
  return values.length === 0 || values.some((value) => ipMatches(actual, value));
}

function matchDimension(actual, expected, matcher = oneOf) {
  const values = list(expected);
  return values.length === 0 || values.some((value) => matcher(actual, value));
}

export function matchesPrecisionRule(ruleMatch = {}, identity = {}) {
  // Accept both the nested precision identity and the platform routing
  // context emitted by application-routing.js. This keeps application/process
  // matching in the platform layer instead of coupling it to a kernel.
  const app = identity.app || {
    packageId: identity.package_name || identity.packageName,
    bundleId: identity.bundle_id || identity.bundleId,
    appId: identity.applicationId || identity.app_id || identity.appId,
    uid: identity.uid,
    instanceId: identity.app_instance_id || identity.instanceId,
  };
  const process = identity.process || {
    name: identity.process_name || identity.processName,
    executable: identity.executable,
    path: identity.process_path || identity.processPath,
  };
  const destination = identity.destination || {};
  const dns = identity.dns || {};

  const checks = [
    matchDimension(app.packageId, ruleMatch.package_id ?? ruleMatch.package_name),
    matchDimension(app.bundleId, ruleMatch.bundle_id),
    matchDimension(app.appId, ruleMatch.application_id ?? ruleMatch.app_id),
    matchDimension(app.uid, ruleMatch.uid),
    matchDimension(app.instanceId, ruleMatch.app_instance_id),
    matchDimension(process.name, ruleMatch.process ?? ruleMatch.process_name),
    matchDimension(process.executable, ruleMatch.executable),
    matchDimension(process.path, ruleMatch.process_path),
    matchDimension(destination.domain, ruleMatch.domain, domainEquals),
    matchDimension(destination.domain, ruleMatch.domain_suffix, domainSuffix),
    matchDimension(destination.sni, ruleMatch.sni, domainEquals),
    anyIpMatches(destination.ip, ruleMatch.ip),
    matchDimension(destination.port, ruleMatch.port),
    matchDimension(destination.protocol, ruleMatch.protocol),
    matchDimension(destination.transport, ruleMatch.transport),
    matchDimension(dns.query, ruleMatch.dns_query, domainEquals),
  ];

  return checks.every(Boolean);
}

export function explainPrecisionMatch(ruleMatch = {}, identity = {}) {
  return {
    matched: matchesPrecisionRule(ruleMatch, identity),
    semantics: {
      dimensions: "AND",
      valuesWithinDimension: "OR",
      ruleEvaluation: "parallel",
    },
  };
}
