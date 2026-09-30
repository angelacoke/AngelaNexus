import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_ENDPOINT_TYPES,
  WARP_TUNNEL_PROTOCOLS,
  WARP_PROVISIONING_ACTIONS,
  createLandingEndpointCatalog,
  createWarpProvisioningRequest,
  provisionUserWarpLandingEndpoint,
  resolveLandingEndpoint,
} from "../src/platform/index.js";

test("WARP is represented as an optional landing exit endpoint", () => {
  const catalog = createLandingEndpointCatalog({
    nodes: [{ id: "us-entry", name: "US Entry" }],
    warp: [{
      id: "warp-default",
      protocol: WARP_TUNNEL_PROTOCOLS.MASQUE,
      credentialRef: "secure:warp:user-a",
    }],
  });

  assert.deepEqual(catalog.map((endpoint) => endpoint.type), [
    LANDING_ENDPOINT_TYPES.NODE,
    LANDING_ENDPOINT_TYPES.WARP,
  ]);
  assert.equal(catalog[1].execution.role, "landing-exit");
  assert.equal(catalog[1].execution.scope, "user");
  assert.equal(catalog[1].execution.countryAffinity, "not-guaranteed");
});

test("WARP landing endpoint supports explicit WireGuard protocol", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{
      id: "warp-wg",
      name: "WARP WG",
      protocol: "wireguard",
      credentialRef: "secure:warp:primary",
    }],
  });
  const result = resolveLandingEndpoint(catalog, { preferredId: "warp-wg" });

  assert.equal(result.selected.type, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(result.selected.protocol, WARP_TUNNEL_PROTOCOLS.WIREGUARD);
  assert.equal(result.selected.credentialRef, "secure:warp:primary");
});

test("WARP without secure credentials fails closed", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{ id: "warp-unprovisioned" }],
  });

  assert.throws(
    () => resolveLandingEndpoint(catalog, { preferredId: "warp-unprovisioned" }),
    /no secure credential reference/,
  );
});

test("disabled WARP endpoints are never selected", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{ id: "warp-disabled", enabled: false, credentialRef: "secure:warp:disabled" }],
  });

  assert.throws(
    () => resolveLandingEndpoint(catalog, { preferredId: "warp-disabled" }),
    /no usable landing endpoint/,
  );
});

test("WARP is not treated as a geographic region", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{
      id: "warp-global",
      name: "WARP global",
      credentialRef: "secure:warp:global",
    }],
  });
  const result = resolveLandingEndpoint(catalog, { preferredType: LANDING_ENDPOINT_TYPES.WARP });

  assert.equal(result.selected.type, LANDING_ENDPOINT_TYPES.WARP);
  assert.equal(result.selected.execution.countryAffinity, "not-guaranteed");
});

test("WARP provisioning is user-scoped and produces an independent landing identity", async () => {
  const calls = [];
  const provisioner = {
    async provision(request) {
      calls.push(request);
      return {
        id: request.scope.id === "user-a" ? "warp-registration-a" : "warp-registration-b",
        credentialRef: request.scope.id === "user-a"
          ? "secure:warp:a"
          : "secure:warp:b",
      };
    },
  };

  const first = await provisionUserWarpLandingEndpoint({
    userScopeId: "user-a",
    protocol: WARP_TUNNEL_PROTOCOLS.MASQUE,
    provisioner,
  });
  const second = await provisionUserWarpLandingEndpoint({
    userScopeId: "user-b",
    protocol: WARP_TUNNEL_PROTOCOLS.MASQUE,
    provisioner,
  });

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.credentialRef, second.credentialRef);
  assert.equal(first.execution.scope, "user");
  assert.equal(second.execution.scope, "user");
  assert.equal(calls[0].action, WARP_PROVISIONING_ACTIONS.CREATE);
  assert.equal(calls[1].scope.type, "user");
});

test("WARP provisioning requires an explicit user scope", () => {
  assert.throws(
    () => createWarpProvisioningRequest({}),
    /WARP user scope is required/,
  );
});
