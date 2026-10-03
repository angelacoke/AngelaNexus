export const LINUX_ROUTE_INTENT_VERSION = 1;

export const LinuxRouteFamilies = Object.freeze({
  IPV4: "ipv4",
  IPV6: "ipv6",
});

export const LinuxRouteTypes = Object.freeze({
  UNICAST: "unicast",
  UNREACHABLE: "unreachable",
  PROHIBIT: "prohibit",
  BLACKHOLE: "blackhole",
  THROW: "throw",
  OTHER: "other",
});

function normalizeFamily(family) {
  return family === LinuxRouteFamilies.IPV4 || family === LinuxRouteFamilies.IPV6 ? family : null;
}

export function evaluateLinuxRouteIntent(intent = {}, evidence = null) {
  const family = normalizeFamily(intent.family);
  const target = typeof intent.target === "string" && intent.target.trim() ? intent.target.trim() : null;
  const observed = evidence && typeof evidence === "object" ? evidence : null;

  if (!family || !target) {
    return Object.freeze({ ok: false, ready: false, reason: "route-intent-invalid" });
  }
  if (!observed) {
    return Object.freeze({ ok: false, ready: false, reason: "route-evidence-missing", family, target });
  }

  const lookupState = observed.lookupState;
  const routeType = observed.routeType;
  const interfaceIndex = observed.interfaceIndex;
  const tableId = observed.tableId;
  const targetMatch = observed.targetMatch === true;

  const ready = lookupState === "verified" &&
    routeType === LinuxRouteTypes.UNICAST &&
    Number.isInteger(interfaceIndex) && interfaceIndex > 0 &&
    Number.isInteger(tableId) && tableId >= 0 &&
    targetMatch;

  return Object.freeze({
    ok: true,
    ready,
    family,
    target,
    reason: ready ? "effective-route-verified" : "effective-route-not-verified",
    evidence: Object.freeze({
      lookupState: lookupState || "failed",
      routeType: routeType || LinuxRouteTypes.OTHER,
      interfaceIndex: Number.isInteger(interfaceIndex) ? interfaceIndex : null,
      tableId: Number.isInteger(tableId) ? tableId : null,
      targetMatch,
    }),
  });
}
