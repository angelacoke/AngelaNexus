import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLinuxRouteIntent, LinuxRouteFamilies, LinuxRouteTypes } from "./linux-route-intent.js";

test("effective IPv4 route intent requires an exact verified unicast route", () => {
  const result = evaluateLinuxRouteIntent(
    { family: LinuxRouteFamilies.IPV4, target: "1.1.1.1" },
    { lookupState: "verified", routeType: LinuxRouteTypes.UNICAST, interfaceIndex: 2, tableId: 254, targetMatch: true },
  );
  assert.equal(result.ready, true);
  assert.equal(result.reason, "effective-route-verified");
});

test("route count or default route alone does not satisfy effective route intent", () => {
  const result = evaluateLinuxRouteIntent(
    { family: LinuxRouteFamilies.IPV4, target: "1.1.1.1" },
    { lookupState: "verified", routeType: LinuxRouteTypes.UNICAST, interfaceIndex: 0, tableId: 254, targetMatch: false, routeCount: 12, defaultRouteCount: 1 },
  );
  assert.equal(result.ready, false);
  assert.equal(result.reason, "effective-route-not-verified");
});

test("unreachable route is never admitted", () => {
  const result = evaluateLinuxRouteIntent(
    { family: LinuxRouteFamilies.IPV6, target: "2001:4860:4860::8888" },
    { lookupState: "verified", routeType: LinuxRouteTypes.UNREACHABLE, interfaceIndex: 3, tableId: 254, targetMatch: true },
  );
  assert.equal(result.ready, false);
});

test("missing or invalid intent fails closed", () => {
  assert.equal(evaluateLinuxRouteIntent({}, null).reason, "route-intent-invalid");
  assert.equal(evaluateLinuxRouteIntent({ family: LinuxRouteFamilies.IPV4, target: "1.1.1.1" }, null).reason, "route-evidence-missing");
});
