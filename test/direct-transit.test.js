import test from "node:test";
import assert from "node:assert/strict";
import {
  DirectTransitActions,
  DirectTransitCapabilities,
  createDirectTransitPolicy,
  validateDirectTransitCapabilities,
  evaluateDirectTransit,
  createDirectTransitSessionState,
} from "../src/core/direct-transit.js";

const nativeCapabilities = [
  DirectTransitCapabilities.NATIVE_SOCKET_PATH,
  DirectTransitCapabilities.NATIVE_ROUTE,
  DirectTransitCapabilities.BYPASS_TUN,
  DirectTransitCapabilities.ROUTE_INTEGRITY,
];

test("direct transit requires native fail-closed capabilities", () => {
  const policy = createDirectTransitPolicy();
  const result = validateDirectTransitCapabilities(nativeCapabilities, policy);
  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("missing native capability fails closed", () => {
  const result = evaluateDirectTransit({
    capabilities: [DirectTransitCapabilities.NATIVE_SOCKET_PATH],
    route: { native: true, consistent: true },
    dnsPath: { consistent: true },
  });
  assert.equal(result.action, DirectTransitActions.FAIL_CLOSED);
  assert.match(result.reasons[0], /^missing-native-capability:/);
});

test("validated sensitive flow remains outside TUN and proxy path", () => {
  const result = evaluateDirectTransit({
    capabilities: nativeCapabilities,
    route: { native: true, consistent: true },
    dnsPath: { consistent: true },
    networkGeneration: 3,
    validatedNetworkGeneration: 3,
  });
  assert.equal(result.action, DirectTransitActions.NATIVE);
});

test("entering TUN or proxy path fails closed", () => {
  const result = evaluateDirectTransit({
    capabilities: nativeCapabilities,
    tunEntered: true,
    route: { native: true, consistent: true },
    dnsPath: { consistent: true },
    networkGeneration: 1,
    validatedNetworkGeneration: 1,
  });
  assert.equal(result.action, DirectTransitActions.FAIL_CLOSED);
  assert.deepEqual(result.reasons, ["sensitive-flow-entered-proxy-path"]);
});

test("network changes require revalidation", () => {
  const result = evaluateDirectTransit({
    capabilities: nativeCapabilities,
    route: { native: true, consistent: true },
    dnsPath: { consistent: true },
    networkGeneration: 4,
    validatedNetworkGeneration: 3,
  });
  assert.equal(result.action, DirectTransitActions.REVALIDATE);
});

test("route and DNS inconsistency cannot become direct transit", () => {
  const route = evaluateDirectTransit({
    capabilities: nativeCapabilities,
    route: { native: false, consistent: true },
    dnsPath: { consistent: true },
  });
  assert.equal(route.action, DirectTransitActions.FAIL_CLOSED);

  const dns = evaluateDirectTransit({
    capabilities: nativeCapabilities,
    route: { native: true, consistent: true },
    dnsPath: { consistent: false },
  });
  assert.equal(dns.action, DirectTransitActions.FAIL_CLOSED);
});

test("session state starts in explicit revalidation state", () => {
  const state = createDirectTransitSessionState({ networkGeneration: 5 });
  assert.equal(state.revalidationRequired, true);
  assert.equal(state.proxyPathEntered, false);
});
