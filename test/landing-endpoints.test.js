import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_ENDPOINT_TYPES,
  WARP_TUNNEL_PROTOCOLS,
  createLandingEndpointCatalog,
  resolveLandingEndpoint,
} from "../src/platform/index.js";

test("WARP is represented as an optional landing exit endpoint", () => {
  const catalog = createLandingEndpointCatalog({
    nodes: [{ id: "us-entry", name: "US Entry" }],
    warp: [{ id: "warp-default", protocol: WARP_TUNNEL_PROTOCOLS.MASQUE }],
  });

  assert.deepEqual(catalog.map((endpoint) => endpoint.type), [
    LANDING_ENDPOINT_TYPES.NODE,
    LANDING_ENDPOINT_TYPES.WARP,
  ]);
  assert.equal(catalog[1].execution.role, "landing-exit");
  assert.equal(catalog[1].execution.countryAffinity, "not-guaranteed");
});

test("WARP landing endpoint supports explicit WireGuard protocol", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{ id: "warp-wg", name: "WARP WG", protocol: "wireguard", credentialRef: "secure:warp:primary" }],
  });
  const result = resolveLandingEndpoint(catalog, { preferredId: "warp-wg" });

  assert.equal(result.selected.type, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(result.selected.protocol, WARP_TUNNEL_PROTOCOLS.WIREGUARD);
  assert.equal(result.selected.credentialRef, "secure:warp:primary");
});

test("disabled WARP endpoints are never selected", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{ id: "warp-disabled", enabled: false }],
  });

  assert.throws(
    () => resolveLandingEndpoint(catalog, { preferredId: "warp-disabled" }),
    /no usable landing endpoint/,
  );
});

test("WARP is not treated as a geographic region", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{ id: "warp-global", name: "WARP US" }],
  });
  const result = resolveLandingEndpoint(catalog, { preferredType: LANDING_ENDPOINT_TYPES.WARP });

  assert.equal(result.selected.type, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(result.selected.execution.countryAffinity, "not-guaranteed");
});
