import test from "node:test";
import assert from "node:assert/strict";
import {
  LANDING_ENDPOINT_TYPES,
  LANDING_ENDPOINT_HEALTH,
  WARP_TUNNEL_PROTOCOLS,
  WARP_PROVISIONING_ACTIONS,
  createLandingEndpointCatalog,
  createWarpProvisioningRequest,
  provisionUserWarpLandingEndpoint,
  resolveLandingEndpoint,
  evaluateLandingEndpoint,
  resolveLandingEndpointWithFallback,
  createWarpCredentialReference,
  serializeWarpCredentialReference,
  parseWarpCredentialReference,
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
    /no usable landing endpoint/,
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

test("generated WARP credentials are stored in the user vault and never returned", async () => {
  const records = new Map();
  const credentialVault = {
    async put(reference, credential) {
      records.set(reference.scope.id + ":" + reference.credentialId, credential);
    },
    async get(reference) {
      return records.get(reference.scope.id + ":" + reference.credentialId);
    },
    async remove(reference) {
      records.delete(reference.scope.id + ":" + reference.credentialId);
    },
  };

  const generatedCredential = { registrationToken: "secret-material" };
  const provisioner = {
    async provision() {
      return {
        id: "warp-generated-a",
        credentialId: "credential-a",
        credential: generatedCredential,
      };
    },
  };

  const endpoint = await provisionUserWarpLandingEndpoint({
    userScopeId: "user-a",
    action: WARP_PROVISIONING_ACTIONS.CREATE,
    provisioner,
    credentialVault,
  });

  assert.equal(endpoint.credentialRef, "warp-vault-v1:user-a:credential-a");
  assert.equal(endpoint.credential, undefined);
  assert.deepEqual(
    await credentialVault.get({
      version: 1,
      scope: { type: "user", id: "user-a" },
      credentialId: "credential-a",
    }),
    generatedCredential,
  );
});

test("generated WARP credentials fail closed when no vault is supplied", async () => {
  const provisioner = {
    async provision() {
      return {
        id: "warp-generated-a",
        credential: { registrationToken: "secret-material" },
      };
    },
  };

  await assert.rejects(
    provisionUserWarpLandingEndpoint({
      userScopeId: "user-a",
      action: WARP_PROVISIONING_ACTIONS.CREATE,
      provisioner,
    }),
    /credential vault is required/,
  );
});

test("WARP credential references round-trip without exposing credential material", () => {
  const reference = createWarpCredentialReference({
    userScopeId: "user/a",
    credentialId: "credential:1",
  });
  const serialized = serializeWarpCredentialReference(reference);
  const parsed = parseWarpCredentialReference(serialized);

  assert.equal(serialized, "warp-vault-v1:user%2Fa:credential%3A1");
  assert.deepEqual(parsed, reference);
  assert.equal(serialized.includes("secret-material"), false);
});

test("unavailable WARP produces an actionable platform state", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{
      id: "warp-down",
      credentialRef: "secure:warp:down",
      health: LANDING_ENDPOINT_HEALTH.UNAVAILABLE,
    }],
  });
  const state = evaluateLandingEndpoint(catalog[0], {
    reachable: false,
    reason: "WARP tunnel health check failed",
  });

  assert.equal(state.health, LANDING_ENDPOINT_HEALTH.UNAVAILABLE);
  assert.equal(state.available, false);
  assert.equal(state.userActionRequired, true);
  assert.match(state.reason, /health check failed/);
});

test("WARP outage may fall back only to another landing endpoint", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{
      id: "warp-down",
      credentialRef: "secure:warp:down",
      health: LANDING_ENDPOINT_HEALTH.UNAVAILABLE,
    }],
    nodes: [{
      id: "vps-landing",
      health: LANDING_ENDPOINT_HEALTH.AVAILABLE,
    }],
  });

  const result = resolveLandingEndpointWithFallback(catalog, {
    preferredId: "warp-down",
  });

  assert.equal(result.selected.id, "vps-landing");
  assert.equal(result.selected.type, LANDING_ENDPOINT_TYPES.NODE);
  assert.equal(result.fallbackUsed, true);
  assert.match(result.warning, /no usable landing endpoint/);
});

test("WARP outage never falls back to direct connection", () => {
  const catalog = createLandingEndpointCatalog({
    warp: [{
      id: "warp-down",
      credentialRef: "secure:warp:down",
      health: LANDING_ENDPOINT_HEALTH.UNAVAILABLE,
    }],
  });

  assert.throws(
    () => resolveLandingEndpointWithFallback(catalog, { preferredId: "warp-down" }),
    /direct connection is not an allowed fallback/,
  );
});
